"""Persistent research graph with bounded registered tools and an evidence journal."""
from __future__ import annotations

import asyncio
import json
import shutil
import sys
import time
from contextlib import suppress
from pathlib import Path
from typing import TypedDict

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel, ConfigDict, Field

from .contracts import (STAGES, ResearchAnalysis, ResearchBudgetExceeded,
                        ResearchCancelled, ResearchQuestion, ResearchReview)
from .domain import (ResearchRecipe, confirm_results, prepare_dataset,
                     run_baseline, run_experiments, write_json)
from .execution import capability_report, declarative_execution_guard
from .literature import acquire_full_text, search_literature
from .manuscript import build_manuscript
from .provider import ResearchProvider
from .store import ResearchStore


class SearchQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=5, max_length=200)
    rationale: str = Field(max_length=1000)


class GraphState(TypedDict):
    run_id: str
    last_stage: str


class ResearchService:
    def __init__(self, root: Path):
        root = Path(root).resolve()
        root.mkdir(parents=True, exist_ok=True)
        self._lease = (root / "worker.lock").open("a+b")
        try:
            # Reading a byte locked by another process is itself denied on Windows.
            if (root / "worker.lock").stat().st_size == 0:
                self._lease.write(b"0")
                self._lease.flush()
            self._lease.seek(0)
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(self._lease.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._lease.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            self._lease.close()
            raise RuntimeError("同一研究目录已有工作进程，请使用单个服务实例") from exc
        try:
            self.store = ResearchStore(root)
            self.provider = ResearchProvider(self.store)
        except Exception:
            if hasattr(self, "store"):
                self.store.close()
            self._lease.close()
            raise
        self.tasks: dict[str, asyncio.Task] = {}
        self.closing = False
        self.graph = None
        self._checkpoint_context = None
        self.deadlines = {}
        self._segments = {}
        self.exporting = False
        self.export_done = asyncio.Event()
        self.export_done.set()
        self.configuring = False
        self.settings_done = asyncio.Event()
        self.settings_done.set()

    async def start(self):
        self._checkpoint_context = AsyncSqliteSaver.from_conn_string(str(self.store.root / "graph.sqlite3"))
        saver = await self._checkpoint_context.__aenter__()
        builder = StateGraph(GraphState)
        for stage, _ in STAGES:
            async def node(state, key=stage):
                await self._stage(state["run_id"], key)
                return {"last_stage": key}
            builder.add_node(stage, node)
        builder.add_edge(START, STAGES[0][0])
        for (left, _), (right, _) in zip(STAGES, STAGES[1:]):
            builder.add_edge(left, right)
        builder.add_edge(STAGES[-1][0], END)
        self.graph = builder.compile(checkpointer=saver)
        self.store.mark_stale()
        for run in reversed(self.store.list_runs()):
            if run["status"] == "interrupted":
                # Only the interrupted former active run is recovered. Budgets remain cumulative.
                await self.resume(run["id"], automatic=True)
                break

    async def shutdown(self):
        self.closing = True
        await self.settings_done.wait()
        await self.export_done.wait()
        if self.tasks:
            await asyncio.gather(*list(self.tasks.values()), return_exceptions=True)
        if self._checkpoint_context:
            await self._checkpoint_context.__aexit__(None, None, None)
        self.store.close()
        self._lease.close()

    def create(self, request):
        if self.configuring:
            raise ValueError("论文模型设置正在保存，请稍后启动研究")
        if self.exporting:
            raise ValueError("正在导出已完成研究，请稍后启动新研究")
        if request.domain not in {"digits_robustness", "yolo_tradeoff"} or request.mode != "autonomous":
            raise ValueError("当前支持手写数字抗干扰与YOLO精度速度实验")
        if request.domain == "digits_robustness" and request.budget.max_trials is not None and request.budget.max_trials < 15:
            raise ValueError("完整三种子流程至少需要15次拟合；请设置足够预算")
        if request.domain == "yolo_tradeoff":
            from .yolo_domain import capability
            if not capability()["available"]:
                raise ValueError("YOLO实验需要已登记的本地权重与Ultralytics环境")
            if request.budget.max_trials is not None and request.budget.max_trials < 5:
                raise ValueError("YOLO流程最多需要5个评测作业，请留空或设置至少5；不进行训练")
        run, created = self.store.create(request)
        if created:
            self._schedule(run["id"])
        return run

    def _schedule(self, run_id):
        if run_id not in self.tasks or self.tasks[run_id].done():
            self.tasks[run_id] = asyncio.create_task(self._work(run_id))

    async def wait(self, run_id):
        if run_id in self.tasks:
            await self.tasks[run_id]
        return self.store.get(run_id)

    def cancel(self, run_id):
        run = self.store.get(run_id)
        if run["status"] in {"queued", "running", "cancelling"}:
            return self.store.update(run_id, {"cancel_requested": True, "status": "cancelling"},
                event={"type": "cancel_requested", "message": "已接收取消，将在工具边界停止"})
        return run

    async def resume(self, run_id, automatic=False):
        if self.configuring:
            raise ValueError("论文模型设置正在保存，请稍后恢复研究")
        if self.exporting:
            raise ValueError("正在导出已完成研究，请稍后恢复")
        run = self.store.get(run_id)
        if run["status"] not in {"interrupted", "failed", "needs_input"}:
            raise ValueError("该状态不能恢复")
        if any(r["id"] != run_id and r["status"] in {"queued", "running", "cancelling"}
               for r in self.store.list_runs()):
            raise ValueError("已有研究正在执行")
        if run["budget"]["max_seconds"] is not None and run["budget"]["elapsed_seconds"] >= run["budget"]["max_seconds"]:
            raise ValueError("累计时间预算已耗尽，请创建有明确新预算的任务")
        def mutate(r):
            r.update(status="queued", cancel_requested=False, error="")
            if automatic:
                r["automatic_recoveries"] += 1
            else:
                r["intervention_count"] += 1
                r["interventions"].append({"id": f"resume-{len(r['interventions'])}",
                    "title": "手动恢复", "status": "resolved", "reason": "用户请求继续中断任务",
                    "required_action": "已点击恢复", "created_at": r["updated_at"]})
        self.store.update(run_id, mutate=mutate, event={"type": "run_resumed",
            "message": "自动核对检查点并恢复" if automatic else "手动恢复；保留累计预算"})
        self._schedule(run_id)
        return self.store.get(run_id)

    async def export(self, run_id):
        """Re-render frozen evidence as a new version, with no model call or fit."""
        run = self.store.get(run_id)
        if run["status"] != "completed":
            raise ValueError("仅能重新导出已完成研究")
        if self.closing or self.configuring or self.exporting or any(r["status"] in {"queued", "running", "cancelling"} for r in self.store.list_runs()):
            raise ValueError("已有任务正在执行，请稍后导出")
        self.exporting = True
        self.export_done.clear()
        begin = time.monotonic()
        try:
            for item in run["artifacts"]:
                self.store.artifact_path(run_id, item["id"])
            root = self.store.run_dir(run_id)
            analysis = run["outputs"].get("analysis", {})
            revision = run["outputs"]["manuscript"].get("revision", 1) + 1
            manuscript = await asyncio.to_thread(build_manuscript, root, question=run["goal"],
                literature=self._output(run_id, "reading"), experiment=self._output(run_id, "validation"),
                analysis=analysis, revision=revision)
            if manuscript["status"] != "completed":
                raise ValueError("新版论文PDF导出失败，请查看导出诊断")
            manuscript["analysis"] = analysis
            folder = root / f"export_v{revision}"
            folder.mkdir(exist_ok=True)
            record = {"revision": revision, "originals_preserved": True, "new_model_calls": 0,
                "new_model_fits": 0, "experiment_reused": "frozen raw CSV and existing analysis",
                "duration_seconds": round(time.monotonic() - begin, 3), "discussion": manuscript["quality"]["discussion"]}
            write_json(folder / "export_record.json", record)
            import zipfile
            from .domain import sha256_file
            target = folder / "research_bundle.zip"
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
                paths = [p for p in sorted(root.rglob("*")) if p.is_file() and not p.is_symlink()
                    and p.suffix not in {".zip", ".tmp", ".part"} and not p.name.startswith("qa-")]
                for path in paths:
                    archive.write(path, path.relative_to(root).as_posix())
                archive.writestr("MANIFEST.sha256", "\n".join(f"{sha256_file(p)}  {p.relative_to(root).as_posix()}" for p in paths) + "\n")
            artifacts = [*self._register(run_id, manuscript), self.store.artifact(run_id, folder / "export_record.json", "export_record"),
                         self.store.artifact(run_id, target, "zip")]
            def publish(r):
                r["outputs"].update(manuscript=manuscript, analysis=analysis)
                r["outputs"]["latest_export"] = {**record, "bundle": artifacts[-1]}
                ids = {a["id"] for a in r["artifacts"]}
                r["artifacts"].extend(a for a in artifacts if a["id"] not in ids)
            return self.store.update(run_id, mutate=publish, event={"type": "manuscript_exported",
                "stage": "manuscript", "message": f"第{revision}版已导出，复用原始实验，未新增调用或拟合", "data": record})
        finally:
            self.exporting = False
            self.export_done.set()

    def _elapsed(self, run_id):
        prior, started = self._segments[run_id]
        self.store.update(run_id, mutate=lambda r: r["budget"].update(
            elapsed_seconds=round(prior + time.monotonic() - started, 3)))

    def _cancelled(self, run_id):
        return self.closing or self.store.get(run_id)["cancel_requested"]

    def _boundary(self, run_id):
        if self._cancelled(run_id):
            raise ResearchCancelled("服务关闭" if self.closing else "用户取消")
        if time.monotonic() >= self.deadlines[run_id]:
            raise ResearchBudgetExceeded("累计研究时间预算已耗尽")

    async def _heartbeat(self, run_id):
        while True:
            await asyncio.sleep(2)
            self._elapsed(run_id)

    async def _work(self, run_id):
        run = self.store.get(run_id)
        started = time.monotonic()
        self._segments[run_id] = (run["budget"]["elapsed_seconds"], started)
        cap = run["budget"]["max_seconds"]
        self.deadlines[run_id] = float("inf") if cap is None else started + max(0, cap - run["budget"]["elapsed_seconds"])
        heartbeat = asyncio.create_task(self._heartbeat(run_id))
        self.store.update(run_id, {"status": "running", "error": ""},
                          event={"type": "run_started", "message": "LangGraph 持久化流程启动"})
        config = {"configurable": {"thread_id": run_id}}
        try:
            for artifact in run["artifacts"]:
                self.store.artifact_path(run_id, artifact["id"])
            snapshot = await self.graph.aget_state(config)
            if snapshot.values and not snapshot.next:
                # Journal completion can lag the final durable graph checkpoint.
                pass
            else:
                initial = None if snapshot.values else {"run_id": run_id, "last_stage": ""}
                await self.graph.ainvoke(initial, config, durability="sync")
            self._boundary(run_id)
            self.store.update(run_id, {"status": "completed", "stage": "submission", "progress": 100,
                "quality_status": "candidate_report_novelty_unverified",
                "summary": "研究流程完成，候选稿件与复现包已生成；新颖性未验证，尚未投稿"},
                event={"type": "run_completed", "message": "12阶段完成，真实实验与稿件可下载"})
        except ResearchCancelled:
            status = "interrupted" if self.closing else "cancelled"
            self.store.update(run_id, {"status": status, "summary": "服务关闭，检查点已保留" if self.closing else "已取消，保留已有证据"},
                event={"type": "run_stopped", "status": status, "message": "流程已停止"})
        except Exception as exc:
            message = f"{type(exc).__name__}: {exc}"[:1200]
            def mark(r):
                r.update(status="failed", error=message, summary="运行已停止，请查看失败记录")
                for s in r["stages"]:
                    if s["id"] == r["stage"] and s["status"] == "running":
                        s.update(status="failed", summary=message)
            self.store.update(run_id, mutate=mark,
                event={"type": "run_failed", "status": "failed", "message": message})
        finally:
            heartbeat.cancel()
            with suppress(asyncio.CancelledError):
                await heartbeat
            self._elapsed(run_id)

    async def _async_tool(self, run_id, operation, timeout=120):
        task = asyncio.create_task(operation)
        limit = min(self.deadlines[run_id], time.monotonic() + timeout)
        try:
            while not task.done():
                self._boundary(run_id)
                if time.monotonic() >= limit:
                    raise TimeoutError("外部资料工具达到本次限时")
                await asyncio.sleep(0.2)
            self._boundary(run_id)
            return await task
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    async def _model(self, run_id, role, prompt, schema, fallback):
        self._boundary(run_id)
        try:
            return await self.provider.ask(run_id, role, prompt, schema,
                self.deadlines[run_id], lambda: self._cancelled(run_id))
        except ResearchCancelled:
            raise
        except (ValueError, ResearchBudgetExceeded) as exc:
            self._boundary(run_id)
            self.store.update(run_id, {"model_mode": "mixed_with_recorded_fallback"},
                event={"type": "model_fallback", "stage": self.store.get(run_id)["stage"],
                       "message": f"{role}：使用明确记录的预设回退", "data": {"reason": str(exc)[:300]}})
            return fallback

    def _before_fit(self, run_id):
        self._boundary(run_id)
        def charge(r):
            cap = r["budget"]["max_trials"]
            if cap is not None and r["budget"]["used_trials"] >= cap:
                raise ResearchBudgetExceeded("累计拟合预算已耗尽")
            r["budget"]["used_trials"] += 1
        self.store.update(run_id, mutate=charge, event={"type": "trial_started",
            "stage": self.store.get(run_id)["stage"], "message": "登记一次真实模型拟合"})

    def _before_yolo_trial(self, run_id):
        self._boundary(run_id)
        def charge(r):
            cap = r["budget"]["max_trials"]
            if cap is not None and r["budget"]["used_trials"] >= cap:
                raise ResearchBudgetExceeded("累计评测作业上限已耗尽")
            r["budget"]["used_trials"] += 1
        self.store.update(run_id, mutate=charge, event={"type": "trial_started",
            "stage": self.store.get(run_id)["stage"], "message": "登记一次YOLO精度与延迟评测；不进行训练"})

    def _output(self, run_id, stage):
        return self.store.operation(run_id, stage)

    def _register(self, run_id, output):
        records = [*output.get("artifacts", []), *([output["manifest"]] if output.get("manifest") else [])]
        artifacts = []
        for item in records:
            path = item["path"]
            actual = self.store.artifact(run_id, path, item.get("kind", "file"))
            if item.get("sha256") and item["sha256"] != actual["sha256"]:
                raise ValueError("工具返回产物哈希不一致")
            artifacts.append(actual)
        return artifacts

    async def _stage(self, run_id, stage):
        self._boundary(run_id)
        cached = self._output(run_id, stage)
        if cached is not None:
            # App journal is the idempotence boundary when graph checkpoint lags.
            for artifact in self.store.get(run_id)["artifacts"]:
                self.store.artifact_path(run_id, artifact["id"])
            self.store.event(run_id, type="operation_reused", stage=stage, message="已核对持久化产物，复用完成步骤")
            return
        def mark(r):
            r.update(stage=stage, summary=dict(STAGES)[stage] + "进行中")
            for s in r["stages"]:
                if s["id"] == stage:
                    s.update(status="running", summary="")
        self.store.update(run_id, mutate=mark,
            event={"type": "stage_started", "stage": stage, "message": dict(STAGES)[stage]})
        root = self.store.run_dir(run_id)
        run = self.store.get(run_id)
        output = await self._execute(run_id, stage, root, run)
        self._boundary(run_id)
        artifacts = self._register(run_id, output)
        summary = output.get("stage_summary", dict(STAGES)[stage] + "产物已保存")
        self.store.finish_stage(run_id, stage, output, artifacts, summary)
        aliases = {"ideation": "question", "validation": "experiment"}
        if stage in aliases:
            self.store.update(run_id, mutate=lambda r: r["outputs"].update({aliases[stage]: output}))
        if stage == "manuscript":
            self.store.update(run_id, mutate=lambda r: r["outputs"].update(analysis=output.get("analysis", {})))
        if stage == "review" and output.get("revised_manuscript"):
            self.store.update(run_id, mutate=lambda r: r["outputs"].update(
                manuscript=output["revised_manuscript"], analysis=output["revised_manuscript"].get("analysis", {})))

    async def _execute(self, run_id, stage, root, run):
        if run["domain"] == "yolo_tradeoff" and stage != "submission":
            from .yolo_workflow import execute_yolo_stage
            return await execute_yolo_stage(self, run_id, stage, root, run)
        goal = run["goal"]
        if stage == "literature":
            (root / "project_goal.txt").write_text(goal, encoding="utf-8")
            query = await self._model(run_id, "search_query", "User goal: " + goal +
                "\nImplemented domain: sklearn digits classification with Gaussian training augmentation, clean/noisy testing. "
                "Choose a broad relevant English scholarly search query, no invented citations.", SearchQuery,
                {"query": "image classification robustness Gaussian noise data augmentation", "rationale": "Registered domain scope"})
            try:
                out = await self._async_tool(run_id, search_literature(query["query"], root / "literature"))
            except TimeoutError as exc:
                out = {"ok": False, "status": "unavailable", "records": [], "error": str(exc), "artifacts": []}
            out["query_plan"] = query
            out["stage_summary"] = f"检索到 {len(out.get('records', []))} 条真实书目；覆盖范围受公开接口限制"
            return out
        if stage == "reading":
            records = self._output(run_id, "literature").get("records", [])
            def relevance(record):
                text = (record.get("title", "") + " " + record.get("abstract", "")).lower()
                return sum(weight for term, weight in (("digit", 8), ("handwrit", 8), ("image", 4),
                    ("vision", 4), ("augmentation", 3), ("robust", 2), ("gaussian", 1)) if term in text)
            ranked = sorted(records, key=relevance, reverse=True)
            in_scope = [r for r in ranked if any(term in (r.get("title", "") + " " + r.get("abstract", "")).lower()
                                                   for term in ("digit", "handwrit", "image", "vision"))]
            # Prefer actual vision sources for PDF budget; retain every retrieved record and scope.
            records = in_scope + [r for r in ranked if r not in in_scope]
            try:
                relevant_arxiv = sum(r.get("source") == "arxiv" for r in in_scope)
                out = await self._async_tool(run_id, acquire_full_text(records, root / "literature", max_papers=min(3, relevant_arxiv))) if relevant_arxiv else {
                    "ok": False, "status": "partial", "records": records, "parsed": 0, "artifacts": [],
                    "reason": "检索未得到视觉主题开放全文；保留元数据，未读取不相关全文"}
            except TimeoutError as exc:
                out = {"ok": False, "status": "partial", "records": records, "parsed": 0, "error": str(exc), "artifacts": []}
            out["selection_policy"] = "Title/abstract relevance ranking for digits/handwriting/image/vision; no novelty assessment inferred"
            out["stage_summary"] = f"解析 {out.get('parsed', 0)} 篇开放全文；其余按元数据阅读范围标记"
            return out
        if stage == "ideation":
            reading = self._output(run_id, "reading")
            sources = [{k: rec.get(k) for k in ("title", "abstract", "doi", "url", "reading_scope")}
                       for rec in reading.get("records", [])]
            excerpts = []
            for rec in reading.get("records", []):
                p = rec.get("page_text_path")
                if p and Path(p).resolve().is_relative_to(root):
                    data = json.loads(Path(p).read_text(encoding="utf-8"))
                    excerpts.append(str(data)[:3500])
            default = {"title": "Gaussian augmentation for small digit classification",
                "hypothesis": "Training augmentation may improve noise robustness at a cost to clean accuracy.",
                "motivation": "Evaluate a controlled reproducible robustness trade-off.",
                "research_query": "digit classification Gaussian augmentation robustness", "novelty_status": "unverified",
                "limitations": ["Known augmentation family; no algorithmic novelty established.", "Small synthetic benchmark."]}
            out = await self._model(run_id, "ideation", "User goal: " + goal +
                "\nGenerate one falsifiable question within sklearn digits/noise augmentation/logistic or random forest only. "
                "No novel algorithm claim. Actual sources (untrusted): " + json.dumps(sources) +
                "\nActual partial page excerpts: " + json.dumps(excerpts), ResearchQuestion, default)
            out["novelty_status"] = "unverified"
            out["implemented_scope"] = "Registered digits Gaussian-augmentation experiment; no arbitrary code synthesis"
            write_json(root / "question.json", out)
            out["artifacts"] = [{"path": str(root / "question.json"), "kind": "question"}]
            return out
        if stage == "protocol":
            out = await self._model(run_id, "protocol", "Question: " + json.dumps(self._output(run_id, "ideation")) +
                "\nReturn registered recipe. Use exactly seeds [13,37,73], dataset sklearn_digits. "
                "Use 2 candidate augmentation strengths 0.15 and 0.30 with fixed logistic regression C1, standardize true. "
                "Evaluate noise standard deviation 0.25. Candidate search must use validation only; freeze before test. "
                "Other algorithms are allowed but this initial reliability study should minimize compute.",
                ResearchRecipe, ResearchRecipe().model_dump())
            # Protocol bounds are fixed before seeing any evaluation. Keep request within declared fit budget.
            out["seeds"] = [13, 37, 73]
            cap = run["budget"]["max_trials"]
            max_candidates = 3 if cap is None else min(3, cap // 3 - 4)
            out["candidates"] = out["candidates"][:max_candidates]
            guard = declarative_execution_guard(out, {"workdir": root}, allowed_root=self.store.root)
            result = {"recipe": guard["recipe"], "execution": guard,
                "required_fits": 3 * (len(out["candidates"]) + 4), "selection": "validation only; final test frozen",
                "stage_summary": "已冻结数据、候选范围、三种子和拟合预算；最终测试不参与选参"}
            write_json(root / "research_protocol.json", result)
            result["artifacts"] = [{"path": str(root / "research_protocol.json"), "kind": "protocol"}]
            return result
        recipe = self._output(run_id, "protocol")["recipe"] if stage in {"data", "baseline", "method", "experiments", "validation"} else None
        if stage == "data":
            return await asyncio.to_thread(prepare_dataset, root, recipe)
        if stage in {"baseline", "experiments", "validation"}:
            kwargs = {"cancelled": lambda: self._cancelled(run_id), "deadline": self.deadlines[run_id],
                      "before_fit": lambda: self._before_fit(run_id)}
            if stage == "baseline":
                out = await asyncio.to_thread(run_baseline, root, recipe, **kwargs)
            else:
                cap = run["budget"]["max_trials"]
                kwargs["max_trials"] = None if cap is None else cap - run["budget"]["used_trials"]
                function = run_experiments if stage == "experiments" else confirm_results
                if stage == "experiments":
                    kwargs["phase"] = "search"
                out = await asyncio.to_thread(function, root, recipe, **kwargs)
            self._boundary(run_id)
            if not out.get("ok"):
                raise ValueError(out.get("error") or "真实实验未完成")
            out["stage_summary"] = ("基线验证完成，未开启测试集" if stage == "baseline" else
                "候选验证与选参已冻结，未开启测试集" if stage == "experiments" else "固定配置三种子测试与匹配消融完成")
            return out
        if stage == "method":
            folder = root / "method"
            folder.mkdir(exist_ok=True)
            from . import domain
            shutil.copyfile(domain.__file__, folder / "registered_runner.py")
            write_json(folder / "recipe.json", recipe)
            return {"scope": "Declarative implementation using registered trusted runner", "arbitrary_code_execution": False,
                "artifacts": [{"path": str(p), "kind": p.suffix[1:]} for p in folder.iterdir()],
                "stage_summary": "候选算法配方与代码快照已保存；执行边界已校验"}
        if stage == "manuscript":
            experiment = self._output(run_id, "validation")
            analysis = await self._model(run_id, "analysis", "Analyze actual measured summary: " +
                json.dumps({"summary": experiment["summary"], "limitations": experiment["limitations"]}) +
                "\nAblation is identical to matched control, not independent. Seed SD is not confidence interval. "
                "Seeds share a dataset; no significance or novelty claim. Preserve negative clean-accuracy effects.",
                ResearchAnalysis, {"interpretation": "See raw measured clean/noisy trade-off; no novelty established.",
                    "limitations": experiment["limitations"], "follow_up": ["Independent larger benchmark required."]})
            write_json(root / "analysis.json", analysis)
            manuscript = await asyncio.to_thread(build_manuscript, root, question=goal,
                literature=self._output(run_id, "reading"), experiment=experiment, analysis=analysis)
            manuscript["analysis"] = analysis
            manuscript["artifacts"].append({"path": str(root / "analysis.json"), "kind": "analysis"})
            manuscript["stage_summary"] = "按原始CSV核对数值，生成PDF、Markdown、HTML、TeX及复现包"
            return manuscript
        if stage == "review":
            manuscript = self._output(run_id, "manuscript")
            model_review = await self._model(run_id, "review", "Review actual paper quality and evidence status: " +
                json.dumps({"quality": manuscript["quality"], "summary": manuscript["summary"],
                            "analysis": manuscript["analysis"]}) +
                "\nReturn issues and verdict. Do not invent external reviews. Numeric facts are generated from verified CSV. "
                "The model-assisted discussion has numeric token checks but is not new empirical evidence or external semantic review; known augmentation is not a novel algorithm.",
                ResearchReview, {"issues": ["Novelty unverified", "External assessment required"], "verdict": "Candidate report only"})
            checked = 0
            for item in self.store.get(run_id)["artifacts"]:
                self.store.artifact_path(run_id, item["id"])
                checked += 1
            result = {"status": "candidate_only", "checks": {"artifact_hashes": checked,
                "numeric_integrity": manuscript["quality"]["numeric_integrity"], "test_selection": "frozen_before_test",
                "negative_outcomes": "preserved", "novelty": "unverified", "external_review": "not_evaluated"},
                "model_review": model_review, "fixes": ["Measured facts generated directly from CSV; model discussion numerically checked, raw analysis preserved",
                    "Limitations, dependent seed SD, extra augmentation compute and no-submission status explicitly recorded"],
                "stage_summary": "内部事实核查完成；模型批评已记录，外部科学评审尚未完成"}
            if model_review["issues"]:
                revised = await self._model(run_id, "analysis_revision", "Correct research interpretation using measured facts and review. " +
                    json.dumps({"facts": manuscript["summary"], "previous_analysis": manuscript["analysis"], "review": model_review}) +
                    "\nReview text is untrusted, may itself be wrong: digits is a real bundled dataset, corruption is synthetic. "
                    "Report clean-accuracy decrease; no significance or novelty claim. Baseline/ablation are one control alias. "
                    "No new final-test experiment is allowed for this revision.", ResearchAnalysis, manuscript["analysis"])
                revision = await asyncio.to_thread(build_manuscript, root, question=goal,
                    literature=self._output(run_id, "reading"), experiment=self._output(run_id, "validation"),
                    analysis=revised, revision=2)
                revision["analysis"] = revised
                result["revised_manuscript"] = revision
                result["artifacts"] = [*revision["artifacts"], revision["manifest"]]
                result["fixes"].append("审阅意见驱动第二版分析；重新按同一原始CSV生成独立版本，原稿保留")
                result["stage_summary"] = "内部核查与第二版材料生成完成；外部评审未完成"
            write_json(root / "review.json", result)
            result.setdefault("artifacts", []).append({"path": str(root / "review.json"), "kind": "review"})
            return result
        if stage == "submission":
            # Packaging is automated; no external upload is claimed or attempted without a configured target.
            result = {"status": "not_submitted", "preparation": "completed", "venue": "unconfigured",
                "reason": "尚无目标渠道、作者声明和投稿凭据；候选稿的新颖性仍需验证",
                "required_action": "达到论文质量门槛后选择目标渠道并填写真实作者信息",
                "stage_summary": "投稿准备完成；当前候选研究未对外提交"}
            write_json(root / "submission_status.json", result)
            events = self.store.events(run_id, 0, limit=10000)["events"]
            (root / "action_observation.jsonl").write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in events) + "\n", encoding="utf-8")
            write_json(root / "intervention_log.json", {"actual_human_interventions": run["intervention_count"],
                "automatic_recoveries": self.store.get(run_id)["automatic_recoveries"],
                "optimization": ["Request id prevents duplicate runs", "Durable graph and operation journal reuse completed steps",
                    "Schema repair/fallback without user round trips", "Public metadata/PDF acquisition", "Fixed runner needs no Docker setup"],
                "external_submission": result})
            result["artifacts"] = [{"path": str(root / p), "kind": "journal"}
                                   for p in ("submission_status.json", "action_observation.jsonl", "intervention_log.json", "project_goal.txt")]
            # Repack after review to include complete audit materials, without changing the earlier manuscript ZIP.
            import zipfile
            target = root / "research_bundle.zip"
            with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
                for path in sorted(root.rglob("*")):
                    if path.is_file() and path != target and path.suffix != ".tmp":
                        archive.write(path, path.relative_to(root).as_posix())
            result["artifacts"].append({"path": str(target), "kind": "zip"})
            return result
        raise ValueError("未知研究阶段")

    async def capabilities(self):
        execution, model, writer = await asyncio.gather(asyncio.to_thread(capability_report), self.provider.health(), self.provider.writer.health())
        from .yolo_domain import capability
        yolo = capability()
        return {"model": model, "writer": writer, "execution": {**execution, "available": execution["fixed_runner"]["available"] or yolo["available"],
                "detail": execution["notice"]},
            "domains": [{"id": "yolo_tradeoff", "label": "YOLO检测精度与速度优化", "available": yolo["available"],
                "description": "固定已有YOLO权重，比较输入尺寸对检测精度和推理延迟的影响；不重训",
                "question": "同一个YOLO模型用320、480、640输入时，哪些配置能加快检测并保留精度？",
                "dataset": "公开COCO128标注样例；划分选配置与评测两部分，预训练可能见过这些图像",
                "comparison": "同一权重、FP32、batch=1；以640输入为基线，比较320和480",
                "metrics": "mAP50、mAP50–95、预热后端到端延迟（毫秒）与单张吞吐量（FPS）",
                "outputs": "全部配置结果、精度—延迟图、选定配置、原始测量和研究报告",
                "goal_usage": "填写重点用于文献检索和结果论述。当前只优化输入尺寸，不自动改结构或重训；公开样例不证明真实场景泛化。"},
                {"id": "digits_robustness", "label": "手写数字加噪训练对照", "available": execution["fixed_runner"]["available"],
                 "description": "手写数字训练加噪与不加噪的固定对照实验",
                 "question": "训练时加入噪声，能否提高干扰图片的识别率？正常图片的准确率会下降多少？",
                 "dataset": "1797张8×8手写数字图片，标签为0至9",
                 "comparison": "训练时加噪声与不加噪声；三个随机种子，共享固定数据划分",
                 "metrics": "正常图片和加噪图片的分类准确率、Macro F1及训练耗时",
                 "outputs": "对照结果、图表、原始预测、分析和研究报告",
                 "goal_usage": "填写重点用于检索与论述，实际执行仍是此预设实验，不自动切换数据或方法。"}],
            "stages": [{"id": k, "label": v} for k, v in STAGES],
            "limitations": ["当前自动研究限于登记的YOLO输入尺寸和数字加噪对照实验", "未启用任意生成代码沙箱",
                "全文限开放arXiv PDF，公式/表格需额外核验", "流程完成不代表新颖性、接受或发表"]}
