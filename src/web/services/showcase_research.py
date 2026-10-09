"""读取已完成的公开YOLO示例及登记产物，为同页演示提供稳定视图。"""
from __future__ import annotations

import json
from pathlib import Path

from .showcase_service import ROOT

RUN_ID = "bd8c2a7ccaff4ae4b3be7f7e6fa13c43"
ARTIFACTS = {
    "report": ("manuscript_v3/paper.html", "研究报告 · 第三版", "html", "text/html"),
    "table": ("experiments/metrics.csv", "原始评测CSV", "text", "text/plain"),
    "figure": ("manuscript_v3/accuracy_latency.png", "精度与延迟图", "image", "image/png"),
    "pdf": ("manuscript_v3/paper.pdf", "下载报告PDF", "pdf", "application/pdf"),
}


def stage_artifact(current, file_id: str):
    """仅返回指定已完成示例的四类登记产物，并复用原始哈希核验。"""
    entry = ARTIFACTS.get(file_id)
    if current is None or entry is None:
        return None
    try:
        run = current.store.get(RUN_ID)
        if run["status"] != "completed":
            return None
        record = next((item for item in run["artifacts"] if item["path"] == entry[0]), None)
        if record is None:
            return None
        path = current.store.artifact_path(RUN_ID, record["id"])
    except (KeyError, ValueError, OSError):
        return None
    return path, entry[3]


def stage_research(current=None, *, root: Path = ROOT):
    """现场只读保存的运行；缺少本机记录时保留已归档的事实摘要。"""
    source = "本机已完成运行"
    try:
        if current is None:
            raise KeyError(RUN_ID)
        run = current.store.get(RUN_ID)
        if run["status"] != "completed":
            raise KeyError(RUN_ID)
    except KeyError:
        source = "已归档运行快照"
        try:
            run = json.loads((root / "evidence/research-yolo-runtime-smoke.json").read_text(encoding="utf-8"))["run"]
        except (OSError, ValueError, KeyError):
            return {"available": False, "title": "YOLO 精度与速度研究", "runId": RUN_ID,
                    "status": "unavailable", "source": source, "summary": "保存的研究记录暂不可读。",
                    "metrics": [], "stages": [], "comparison": [], "artifacts": [],
                    "limitation": "可先展示本地智能体、视觉检测与创意应用。"}
    experiment = run.get("outputs", {}).get("experiment", {})
    completed = sum(stage.get("status") == "completed" for stage in run.get("stages", []))
    elapsed = run.get("budget", {}).get("elapsed_seconds", 0)
    metrics = [
        {"label": "完成阶段", "value": f"{completed} / {len(run.get('stages', []))}"},
        {"label": "运行耗时", "value": f"{elapsed:g} 秒"},
        {"label": "评测作业", "value": str(experiment.get("evaluation_jobs_completed", 5))},
        {"label": "新增训练", "value": str(experiment.get("training_fits", 0))},
        {"label": "登记产物", "value": str(len(run.get("artifacts", [])))},
    ]
    comparison = [{key: row.get(key) for key in ("imgsz", "map50_95", "latency_ms", "split")}
                  for row in experiment.get("summary", [])]
    artifacts = [{"id": file_id, "label": entry[1], "kind": entry[2],
                  "available": stage_artifact(current, file_id) is not None,
                  "href": f"/api/showcase/research/files/{file_id}"}
                 for file_id, entry in ARTIFACTS.items()]
    return {"available": True, "title": "YOLO 输入尺寸、精度与速度", "runId": RUN_ID,
            "status": run["status"], "source": source,
            "summary": "同一权重比较 320、480、640 输入；选参后在第二拆分复验，保留负结果。",
            "metrics": metrics, "comparison": comparison,
            "stages": [{key: stage.get(key) for key in ("id", "label", "status")}
                       for stage in run.get("stages", [])], "artifacts": artifacts,
            "limitation": "当前为固定任务的真实运行样例；第二拆分未复现480的速度优势，COCO128可能与预训练重叠，尚未投稿。"}
