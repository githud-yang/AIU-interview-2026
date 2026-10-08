"""Archive actual Ultralytics training outputs with provenance and hashes."""
from __future__ import annotations

import csv
from datetime import datetime, timezone
import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import shutil
import sys


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    temporary.replace(path)


def environment():
    versions = {}
    for name in ["ultralytics", "torch", "torchvision", "numpy", "opencv-python", "PyYAML"]:
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    return {"python": sys.version, "executable": sys.executable, "platform": platform.platform(), "packages": versions}


def archive_run(run_dir, *, parameters, metrics=None, output_weights=None, summary_path=None,
                evidence_dir=None, started_at=None, completed_at=None, dataset=None):
    training_completed_now = completed_at is not None
    dataset_origin = "training_runtime" if dataset is not None and training_completed_now else "archive_runtime" if dataset is not None else "unavailable"
    run_dir = Path(run_dir).resolve()
    csv_path = run_dir / "results.csv"
    best = run_dir / "weights" / "best.pt"
    if not csv_path.is_file() or not best.is_file():
        raise ValueError("训练目录必须包含真实 results.csv 和 weights/best.pt")
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        rows = [{key.strip(): value.strip() for key, value in row.items()} for row in csv.DictReader(handle)]
    if not rows:
        raise ValueError("results.csv 没有实际训练轮次，不能归档为空结果")
    final = {}
    for key, value in rows[-1].items():
        try:
            final[key] = float(value)
        except ValueError:
            final[key] = value
    archived_at = datetime.now(timezone.utc)
    stamp = archived_at.strftime("%Y%m%dT%H%M%S%fZ")
    archive = Path(evidence_dir or run_dir.parent / "evidence") / f"{run_dir.name}_{stamp}"
    archive.mkdir(parents=True, exist_ok=False)
    artifacts = []
    patterns = ["results.csv", "results.png", "args.yaml", "*curve.png", "confusion_matrix*.png", "val_batch*_pred.jpg", "val_batch*_labels.jpg"]
    files = sorted({file for pattern in patterns for file in run_dir.glob(pattern) if file.is_file()})
    for file in files:
        destination = archive / file.name
        shutil.copy2(file, destination)
        artifacts.append({"file": file.name, "sha256": sha256(destination), "bytes": destination.stat().st_size})
    if output_weights:
        destination = Path(output_weights).resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination != best:
            temporary = destination.with_suffix(destination.suffix + ".tmp")
            shutil.copy2(best, temporary)
            temporary.replace(destination)
    else:
        destination = best
    metrics_origin = "best_checkpoint_validation" if metrics is not None else "last_epoch_csv"
    if metrics is None and summary_path and Path(summary_path).is_file():
        try:
            previous = json.loads(Path(summary_path).read_text(encoding="utf-8"))
            previous_run = previous.get("run_dir")
            same_weights = previous.get("weights_sha256") in (None, sha256(best))
            if previous_run and Path(previous_run).resolve() == run_dir and previous.get("metrics") and same_weights:
                metrics = previous["metrics"]
                metrics_origin = previous.get("metrics_origin", "best_checkpoint_validation_legacy_summary")
                started_at = started_at or previous.get("started_at")
                completed_at = completed_at or previous.get("completed_at")
                if dataset is None:
                    dataset = previous.get("dataset")
                    dataset_origin = previous.get("dataset_origin", dataset_origin)
        except (ValueError, OSError, TypeError):
            pass
    summary = {
        "schema_version": 2, "started_at": started_at, "completed_at": completed_at,
        "archived_at": archived_at.isoformat(),
        "parameters": parameters, "run_dir": str(run_dir), "completed_epochs": len(rows),
        "weights": str(destination), "weights_sha256": sha256(destination),
        "metrics": metrics if metrics is not None else {key: value for key, value in final.items() if key.startswith("metrics/")},
        "metrics_origin": metrics_origin,
        "last_epoch_metrics": final, "environment": environment(),
        "environment_origin": "current_training_runtime" if training_completed_now else "archive_runtime",
        "dataset": dataset, "dataset_origin": dataset_origin,
        "evidence_dir": str(archive), "artifacts": artifacts,
        "note": "coco8 仅用于流程验证，不能代表真实场景泛化能力；固定 seed 提高可复现性，跨硬件不保证逐位一致",
    }
    versions = summary["environment"]["packages"]
    version_file = archive / "environment-versions.txt"
    version_file.write_text(
        "# Runtime snapshot; use the same Python/CUDA platform for reproduction.\n" +
        "\n".join(f"{name}=={version}" for name, version in versions.items() if version) + "\n", encoding="utf-8"
    )
    artifacts.append({"file": version_file.name, "sha256": sha256(version_file), "bytes": version_file.stat().st_size, "generated": True})
    write_json(archive / "manifest.json", summary)
    if summary_path:
        write_json(summary_path, summary)
    return summary


def dataset_fingerprint(data):
    """Hash local training image/label files when the trainer resolves a dataset."""
    if not isinstance(data, dict):
        return {"configured": str(data), "fingerprint_available": False}
    if not data.get("path"):
        return {"fingerprint_available": False, "reason": "dataset root was not resolved"}
    root = Path(data["path"])
    entries = []
    if root.is_dir():
        for subdir in [root / "images", root / "labels"]:
            if subdir.is_dir():
                suffixes = {".txt"} if subdir.name == "labels" else {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff", ".dng", ".mpo", ".heic", ".pfm"}
                for file in sorted(subdir.rglob("*")):
                    if file.is_file() and file.suffix.lower() in suffixes:
                        entries.append({"file": file.relative_to(root).as_posix(), "sha256": sha256(file)})
    serialized = json.dumps(entries, sort_keys=True).encode()
    return {"path": str(root), "train": str(data.get("train", "")), "val": str(data.get("val", "")),
            "names": data.get("names", {}), "file_count": len(entries), "files": entries,
            "manifest_sha256": hashlib.sha256(serialized).hexdigest() if entries else None,
            "fingerprint_available": bool(entries)}
