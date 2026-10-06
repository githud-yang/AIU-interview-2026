"""Ultralytics 训练入口；输出真实指标及提交用摘要。"""
import argparse
import json
import shutil
from pathlib import Path
from ultralytics import YOLO
ROOT = Path(__file__).resolve().parents[2]

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="yolo11n.pt")
    p.add_argument("--data", default="coco8.yaml")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--device", default="cpu")
    a = p.parse_args()
    initial = a.model
    if a.model == "yolo11n.pt":
        initial = str(ROOT / "assets/models/yolo11n.pt")
    model = YOLO(initial)
    result = model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch,
                         device=a.device, workers=0, project=str(ROOT / "runs/detect"), name="coco8_baseline", seed=42)
    best = Path(model.trainer.best)
    target = ROOT / "assets/models/best.pt"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, target)
    summary = {"parameters": vars(a), "run_dir": str(model.trainer.save_dir),
               "weights": "assets/models/best.pt", "metrics": result.results_dict,
               "note": "coco8 仅用于流程验证，不能代表真实场景泛化能力"}
    (ROOT / "docs/training_result.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
if __name__ == "__main__": main()
