"""Reproducible Ultralytics training and provenance-backed evidence export."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
if __package__:
    from .evidence import archive_run, dataset_fingerprint, sha256
else:
    from evidence import archive_run, dataset_fingerprint, sha256
ROOT = Path(__file__).resolve().parents[2]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model", default="yolo11n.pt")
    p.add_argument("--data", default="coco8.yaml")
    p.add_argument("--epochs", type=int, default=30)
    p.add_argument("--imgsz", type=int, default=640)
    p.add_argument("--batch", type=int, default=4)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--workers", type=int, default=0)
    p.add_argument("--name", default="coco8_baseline")
    p.add_argument("--project", type=Path, default=ROOT / "runs/detect")
    p.add_argument("--weights-output", type=Path, default=ROOT / "assets/models/best.pt")
    p.add_argument("--summary", type=Path, default=ROOT / "docs/training_result.json")
    p.add_argument("--evidence-dir", type=Path, default=ROOT / "docs/evidence")
    p.add_argument("--archive-only", type=Path, help="archive an existing completed run without retraining")
    a = p.parse_args()
    if a.epochs < 1 or a.imgsz < 32 or a.batch < 1 or a.workers < 0:
        p.error("epochs/batch 必须为正数，imgsz 至少 32，workers 不得为负")
    started_at = datetime.now(timezone.utc).isoformat()
    if a.archive_only:
        try:
            import yaml
            args_file = a.archive_only / "args.yaml"
            parameters = yaml.safe_load(args_file.read_text(encoding="utf-8")) if args_file.is_file() else {}
            summary = archive_run(a.archive_only, parameters=parameters, output_weights=a.weights_output,
                                  summary_path=a.summary, evidence_dir=a.evidence_dir)
        except (ImportError, ValueError, OSError) as exc:
            p.error(str(exc))
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    from ultralytics import YOLO
    initial = a.model
    if a.model == "yolo11n.pt" and (ROOT / "assets/models/yolo11n.pt").is_file():
        initial = str(ROOT / "assets/models/yolo11n.pt")
    model = YOLO(initial)
    result = model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch,
                         device=a.device, workers=a.workers, project=str(a.project), name=a.name,
                         seed=a.seed, deterministic=True)
    parameters = {key: str(value) if isinstance(value, Path) else value for key, value in vars(a).items()}
    if Path(initial).is_file():
        parameters["initial_weights_sha256"] = sha256(initial)
    summary = archive_run(model.trainer.save_dir, parameters=parameters,
                          metrics={key: float(value) for key, value in result.results_dict.items()},
                          output_weights=a.weights_output, summary_path=a.summary, evidence_dir=a.evidence_dir,
                          started_at=started_at, completed_at=datetime.now(timezone.utc).isoformat(),
                          dataset=dataset_fingerprint(model.trainer.data))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
if __name__ == "__main__": main()
