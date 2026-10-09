"""Registered YOLO resolution study; stage outputs retain actual measurement scope."""
from __future__ import annotations

import asyncio
import json
import shutil
from pathlib import Path

from .contracts import ResearchAnalysis, ResearchReview
from .domain import write_json
from .literature import acquire_full_text, search_literature
from .manuscript import build_manuscript


async def execute_yolo_stage(service, run_id, stage, root: Path, run):
    from . import yolo_domain

    goal = run["goal"]
    if stage == "literature":
        (root / "project_goal.txt").write_text(goal, encoding="utf-8")
        query = "YOLO object detection input resolution accuracy inference latency"
        out = await service._async_tool(run_id, search_literature(query, root / "literature"))
        out["query_plan"] = {"query": query, "goal": goal,
                             "rationale": "Registered input-resolution accuracy/latency benchmark"}
        out["stage_summary"] = f"检索到{len(out.get('records', []))}条YOLO与检测性能书目，记录实际覆盖范围"
        return out
    if stage == "reading":
        records = service._output(run_id, "literature").get("records", [])
        def relevance(record):
            text = (record.get("title", "") + " " + record.get("abstract", "")).lower()
            return sum(text.count(term) for term in ("yolo", "object detection", "latency", "resolution", "real-time"))
        ranked = sorted(records, key=relevance, reverse=True)
        relevant = [record for record in ranked if relevance(record)]
        out = await service._async_tool(run_id, acquire_full_text(
            relevant + [r for r in ranked if r not in relevant], root / "literature",
            max_papers=min(3, sum(r.get("source") == "arxiv" for r in relevant))))
        out["selection_policy"] = "YOLO/detection/resolution/latency title and abstract relevance; no exhaustive novelty claim"
        out["stage_summary"] = f"实际解析{out.get('parsed', 0)}篇公开全文；元数据与全文范围分别记录"
        return out
    if stage == "ideation":
        out = {"title": "YOLO input resolution accuracy-latency trade-off",
               "hypothesis": "A lower input resolution may reduce single-image latency while changing detection accuracy.",
               "motivation": goal, "novelty_status": "unverified",
               "implemented_scope": "Fixed existing weights, input resolution only; no training or model architecture changes",
               "limitations": ["COCO-derived public examples may overlap model pretraining; no independent generalization claim"]}
        write_json(root / "question.json", out)
        return {**out, "artifacts": [{"path": str(root / "question.json"), "kind": "question"}],
                "stage_summary": "研究问题已具体化：同一YOLO模型的输入尺寸、精度与延迟取舍"}
    if stage == "protocol":
        out = {"domain": "yolo_tradeoff", "image_sizes": [320, 480, 640], "baseline_imgsz": 640,
               "precision": "FP32", "batch": 1, "training_fits": 0,
               "selection_rule": "Fastest candidate within 0.02 absolute mAP50-95 of the 640 selection baseline; freeze before evaluation",
               "independent_test": False, "evaluation_scope": "COCO-derived deployment benchmark; pretraining overlap possible",
               "goal_usage": "Goal informs discussion and literature, not arbitrary dataset or architecture generation"}
        write_json(root / "research_protocol.json", out)
        return {**out, "artifacts": [{"path": str(root / "research_protocol.json"), "kind": "protocol"}],
                "stage_summary": "已冻结320/480/640、同一权重、FP32和batch1；不训练、不把公开样例当独立测试"}
    if stage == "data":
        try:
            out = await asyncio.to_thread(yolo_domain.prepare_yolo_data, root,
                                          cancelled=lambda: service._cancelled(run_id))
        except Exception:
            service._boundary(run_id)
            raise
        service._boundary(run_id)
        if not out.get("ok"):
            raise ValueError(out.get("error") or "YOLO数据准备未完成")
        out["stage_summary"] = "公开标注样例、固定划分、权重和环境来源已保存，预训练重叠范围明确记录"
        return out
    if stage == "method":
        folder = root / "method"
        folder.mkdir(exist_ok=True)
        shutil.copyfile(yolo_domain.__file__, folder / "registered_yolo_runner.py")
        write_json(folder / "recipe.json", service._output(run_id, "protocol"))
        return {"domain": "yolo_tradeoff", "training_fits": 0, "arbitrary_code_execution": False,
                "artifacts": [{"path": str(p), "kind": p.suffix[1:]} for p in folder.iterdir() if p.is_file()],
                "stage_summary": "输入尺寸对比的受控实现与代码快照已保存，不改旧权重"}
    if stage in {"baseline", "experiments", "validation"}:
        phase = {"baseline": "baseline", "experiments": "search", "validation": "confirmation"}[stage]
        try:
            out = await asyncio.to_thread(yolo_domain.run_yolo_phase, root, phase=phase,
                                          cancelled=lambda: service._cancelled(run_id),
                                          before_trial=lambda: service._before_yolo_trial(run_id))
        except Exception:
            service._boundary(run_id)
            raise
        service._boundary(run_id)
        if not out.get("ok"):
            raise ValueError(out.get("error") or "YOLO真实评测未完成")
        out["stage_summary"] = {"baseline": "640基线的真实检测精度与预热后延迟测量完成",
                                "search": "320/480候选已实测；按预先规则选定配置并冻结",
                                "confirmation": "冻结配置与640基线在第二拆分上评测；保留全部精度和速度代价"}[phase]
        return out
    if stage == "manuscript":
        experiment = service._output(run_id, "validation")
        analysis = await service._model(run_id, "analysis", "User focus: " + goal +
            "\nInterpret this actual YOLO input-resolution benchmark: " + json.dumps({
                "summary": experiment["summary"], "limitations": experiment["limitations"],
                "selection": experiment.get("selection", experiment.get("selected"))}) +
            "\nNo retraining, model architecture change, novelty, external review, independent test or field deployment claim. "
            "COCO public samples may overlap pretraining. FPS is reciprocal of measured single-image latency, not camera FPS. Preserve accuracy losses.",
            ResearchAnalysis, {"interpretation": "See the measured resolution/accuracy/latency table; no new algorithm established.",
                               "limitations": experiment["limitations"], "follow_up": ["Measure on independent deployment data."]})
        write_json(root / "analysis.json", analysis)
        out = await asyncio.to_thread(build_manuscript, root, question=goal,
                                      literature=service._output(run_id, "reading"), experiment=experiment, analysis=analysis)
        if out["status"] != "completed":
            raise ValueError("YOLO报告PDF未成功生成")
        out["analysis"] = analysis
        out["artifacts"].append({"path": str(root / "analysis.json"), "kind": "analysis"})
        out["stage_summary"] = "按YOLO原始CSV和延迟样本生成精度—速度报告与复现材料"
        return out
    if stage == "review":
        manuscript = service._output(run_id, "manuscript")
        review = await service._model(run_id, "review", "Review this actual YOLO benchmark: " + json.dumps({
            "quality": manuscript["quality"], "summary": manuscript["summary"], "analysis": manuscript["analysis"]}) +
            "\nFixed pretrained weights; public COCO samples may overlap pretraining. "
            "No independent generalization, model innovation, retraining, significance or external review established. "
            "Check measurement scope, latency timing, selection/evaluation separation and retained trade-offs.",
            ResearchReview, {"issues": ["Independent deployment data and external assessment required"], "verdict": "Exploratory benchmark report"})
        checked = 0
        for item in service.store.get(run_id)["artifacts"]:
            service.store.artifact_path(run_id, item["id"])
            checked += 1
        result = {"status": "candidate_only", "checks": {"artifact_hashes": checked,
                  "numeric_integrity": manuscript["quality"]["numeric_integrity"], "training_performed": False,
                  "independent_test": False, "evaluation_scope": "COCO-derived exploratory benchmark",
                  "novelty": "unverified", "external_review": "not_evaluated"}, "model_review": review}
        if review["issues"]:
            revised = await service._model(run_id, "analysis_revision", "Revise only the interpretation from these measured facts and untrusted review: " +
                json.dumps({"facts": manuscript["summary"], "previous": manuscript["analysis"], "review": review}) +
                "\nNo new measurements or adaptive selection. Preserve detection accuracy losses, pretraining overlap and hardware-specific latency limits.",
                ResearchAnalysis, manuscript["analysis"])
            revision = await asyncio.to_thread(build_manuscript, root, question=goal,
                literature=service._output(run_id, "reading"), experiment=service._output(run_id, "validation"),
                analysis=revised, revision=2)
            if revision["status"] != "completed":
                raise ValueError("YOLO修订报告PDF未成功生成")
            revision["analysis"] = revised
            result.update(revised_manuscript=revision, artifacts=[*revision["artifacts"], revision["manifest"]])
        write_json(root / "review.json", result)
        result.setdefault("artifacts", []).append({"path": str(root / "review.json"), "kind": "review"})
        result["stage_summary"] = "YOLO事实核查与审阅完成；修订复用冻结测量，独立泛化与外部质量尚待评价"
        return result
    raise ValueError("未知YOLO研究阶段")
