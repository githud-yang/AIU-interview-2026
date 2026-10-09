"""Registered, fixed-weight YOLO resolution study, with auditable measured data.

COCO128 is a subset of COCO *training* images. Disjoint selection/evaluation
subsets do not turn these images into an independent test of a pretrained model.
No training, generated code, user-supplied URL or user-supplied weight is executed.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import math
import os
import platform
import shutil
import statistics
import sys
import tempfile
import time
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Callable
from urllib.parse import urljoin, urlsplit

PROJECT = Path(__file__).resolve().parents[2]
COCO128_URL = "https://github.com/ultralytics/assets/releases/download/v0.0.0/coco128.zip"
COCO128_DOC = "https://docs.ultralytics.com/datasets/detect/coco128/"
IMAGE_SIZES = (320, 480, 640)
BASELINE_SIZE = 640
SPLIT_SEED = 20261009
WARMUPS, REPEATS, SAMPLES_PER_REPEAT = 5, 3, 10
MAX_DOWNLOAD_BYTES, MAX_EXTRACT_BYTES = 20 * 1024**2, 60 * 1024**2
CPU_THREADS = 4
LIMITATIONS = [
    "COCO128 contains the first 128 COCO train2017 images; COCO pretraining may have seen them. This is not an independent generalization test.",
    "The selection and evaluation subsets are non-overlapping, but both remain a small public training-data sample. Known local COCO8 images are excluded when identifiable.",
    "Images without an explicit annotation file are excluded and listed in the manifest, not treated as negative examples. This may bias false-positive assessment.",
    "One existing best.pt checkpoint is held fixed; only inference image size changes. No retraining, architecture innovation, confidence-threshold tuning or new detector is claimed.",
    "Latency is measured on this machine, in FP32, batch 1, with 5 warmups and 3 repeats of 10 single-image predictions. It includes preprocessing, inference, postprocessing and Python dispatch; model loading and image I/O are excluded.",
    "Thirty latency samples reuse ten images per job. Their SD is descriptive, not a confidence interval or independent repeated training. GPU frequency, thermals and background contention are not controlled.",
    "The declared 0.02 absolute mAP50-95 selection tolerance is an engineering constraint, not evidence of statistically equivalent accuracy.",
]
METRIC_FIELDS = ["model", "split", "imgsz", "map50", "map50_95", "precision", "recall", "latency_ms", "latency_sd_ms", "latency_median_ms", "latency_p95_ms", "fps", "repeats", "sample_count", "n_images"]
SAMPLE_FIELDS = ["model", "split", "imgsz", "repeat", "sample", "image_id", "latency_ms"]
COCO_NAMES = "person,bicycle,car,motorcycle,airplane,bus,train,truck,boat,traffic light,fire hydrant,stop sign,parking meter,bench,bird,cat,dog,horse,sheep,cow,elephant,bear,zebra,giraffe,backpack,umbrella,handbag,tie,suitcase,frisbee,skis,snowboard,sports ball,kite,baseball bat,baseball glove,skateboard,surfboard,tennis racket,bottle,wine glass,cup,fork,knife,spoon,bowl,banana,apple,sandwich,orange,broccoli,carrot,hot dog,pizza,donut,cake,chair,couch,potted plant,bed,dining table,toilet,tv,laptop,mouse,remote,keyboard,cell phone,microwave,oven,toaster,sink,refrigerator,book,clock,vase,scissors,teddy bear,hair drier,toothbrush".split(",")


class YoloCancelled(RuntimeError):
    pass


def sha256_file(path: Path | str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024**2), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact(path: Path, kind: str) -> dict:
    path = path.resolve()
    return {"path": str(path), "kind": kind, "sha256": sha256_file(path), "size_bytes": path.stat().st_size}


def _json(path: Path, value: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _csv(path: Path, rows: list[dict], fields: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    temporary.replace(path)


def _check_cancel(cancelled: Callable[[], bool] | None) -> None:
    if cancelled and cancelled():
        raise YoloCancelled("YOLO study cancelled at a download/validation/prediction boundary")


def _inside(root: Path, path: Path | str) -> Path:
    resolved = Path(path).resolve()
    if not resolved.is_relative_to(root.resolve()) or not resolved.is_file():
        raise ValueError("YOLO evidence is missing or outside the owned run directory")
    return resolved


def _verify(root: Path, items: list[dict]) -> None:
    if not items:
        raise ValueError("YOLO evidence must have registered artifact hashes")
    for item in items:
        path = _inside(root, item["path"])
        if sha256_file(path) != item["sha256"] or path.stat().st_size != item["size_bytes"]:
            raise ValueError("YOLO evidence artifact hash/size mismatch")


def verify_runner_source(root: Path | str) -> None:
    """Reject version mixing before reusing evidence or starting another job."""
    root = Path(root).resolve()
    snapshot = root / "experiments" / "yolo_runner_source.py"
    try:
        frozen_digest = sha256_file(_inside(root, snapshot))
        current_digest = sha256_file(Path(__file__).resolve())
    except (OSError, ValueError) as exc:
        raise ValueError("YOLO冻结runner源码缺失或不可读，禁止继续；旧产物已保留。请恢复原版本或新建研究。") from exc
    if frozen_digest != current_digest:
        raise ValueError("YOLO执行源码与冻结runner不一致，禁止继续或复用此运行；旧产物已保留。"
                         f"请恢复原版本或新建研究。 frozen={frozen_digest}, current={current_digest}")


def capability() -> dict:
    """A cheap read-only probe: no heavyweight import, checkpoint load or download."""
    dependencies = {name: importlib.util.find_spec(name) is not None for name in ("torch", "ultralytics", "cv2", "matplotlib")}
    weights = PROJECT / "assets" / "models" / "best.pt"
    available = all(dependencies.values()) and weights.is_file() and weights.resolve().is_relative_to(PROJECT)
    return {"domain": "yolo_tradeoff", "available": available, "dependencies": dependencies,
            "weights_available": weights.is_file(), "weights": "assets/models/best.pt",
            "image_sizes": list(IMAGE_SIZES), "training_fits": 0, "independent_test": False,
            "dataset": "COCO128 public COCO-training sample", "limitations": LIMITATIONS}


def _trusted_url(url: str) -> bool:
    parts = urlsplit(url)
    return (parts.scheme == "https" and parts.hostname in {"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}
            and not parts.username and not parts.password and parts.port in (None, 443))


def _download(path: Path, cancelled=None) -> None:
    import httpx
    url = COCO128_URL
    with httpx.Client(timeout=httpx.Timeout(30, connect=8), follow_redirects=False) as client:
        for _ in range(5):
            _check_cancel(cancelled)
            if not _trusted_url(url):
                raise ValueError("dataset download redirect is outside registered HTTPS hosts")
            with client.stream("GET", url) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise ValueError("dataset redirect has no location")
                    url = urljoin(url, location)
                    continue
                response.raise_for_status()
                if int(response.headers.get("content-length", "0")) > MAX_DOWNLOAD_BYTES:
                    raise ValueError("dataset download exceeds registered size limit")
                total = 0
                with path.open("wb") as stream:
                    for chunk in response.iter_bytes(64 * 1024):
                        _check_cancel(cancelled)
                        total += len(chunk)
                        if total > MAX_DOWNLOAD_BYTES:
                            raise ValueError("dataset download exceeds registered size limit")
                        stream.write(chunk)
                return
    raise ValueError("too many redirects for the registered dataset download")


def _safe_extract(archive: Path, destination: Path, cancelled=None) -> None:
    """Validate every member before writing, rejecting traversal, links and bombs."""
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if len(members) > 600 or sum(item.file_size for item in members) > MAX_EXTRACT_BYTES:
            raise ValueError("dataset archive exceeds registered extraction limit")
        seen = set()
        for item in members:
            name = PurePosixPath(item.filename)
            mode = item.external_attr >> 16
            if (name.is_absolute() or ".." in name.parts or "\\" in item.filename or ":" in item.filename
                    or not name.parts or name.parts[0] != "coco128" or item.filename in seen
                    or (mode & 0o170000) == 0o120000 or item.flag_bits & 1):
                raise ValueError("unsafe dataset archive member")
            seen.add(item.filename)
            target = (destination / Path(*name.parts)).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("dataset archive path escaped its destination")
        for item in members:
            _check_cancel(cancelled)
            target = destination / Path(*PurePosixPath(item.filename).parts)
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(item) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, 64 * 1024)


def _dataset_records(directory: Path) -> list[dict]:
    images = sorted((directory / "images" / "train2017").glob("*.jpg"))
    if len(images) != 128:
        raise ValueError("registered COCO128 archive must contain exactly 128 JPEG images")
    records = []
    for image in images:
        if len(image.stem) != 12 or not image.stem.isdecimal():
            raise ValueError("unexpected COCO128 image identifier")
        label = directory / "labels" / "train2017" / (image.stem + ".txt")
        if not label.is_file():
            # Missing annotations are not invented or inferred to be negatives.
            # Exclude these images and record their IDs in the source manifest.
            continue
        # A missing box is distinct from a legitimate empty annotation file.
        for line in label.read_text(encoding="utf-8").splitlines():
            values = line.split()
            if len(values) != 5:
                raise ValueError("unsupported COCO128 box annotation")
            numbers = [float(value) for value in values]
            if (not all(math.isfinite(value) for value in numbers) or numbers[0] != int(numbers[0])
                    or not 0 <= numbers[0] < 80 or any(not 0 <= value <= 1 for value in numbers[1:])):
                raise ValueError("COCO128 box annotation outside its registered schema")
        records.append({"image_id": image.stem, "image": image.relative_to(directory).as_posix(),
                        "label": label.relative_to(directory).as_posix(), "image_sha256": sha256_file(image), "label_sha256": sha256_file(label)})
    if len(records) < 32:
        raise ValueError("too few explicitly annotated COCO128 examples")
    return records


def _cache_dataset(cancelled=None) -> tuple[Path, dict]:
    cache = PROJECT / "logs" / "research" / "data-cache" / "coco128-v0.0.0"
    manifest = cache / "manifest.json"
    if manifest.is_file():
        saved = json.loads(manifest.read_text(encoding="utf-8"))
        if saved.get("source_url") != COCO128_URL or sha256_file(cache / "coco128.zip") != saved.get("archive_sha256"):
            raise ValueError("cached COCO128 source/archive integrity mismatch")
        if _dataset_records(cache / "coco128") != saved.get("records"):
            raise ValueError("cached COCO128 image/label integrity mismatch")
        return cache, saved
    if cache.exists():
        raise ValueError("incomplete dataset cache: preserve it for inspection rather than replacing evidence")
    cache.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="coco128-download-", dir=cache.parent) as temporary:
        staging = Path(temporary)
        archive = staging / "coco128.zip"
        _download(archive, cancelled)
        _safe_extract(archive, staging, cancelled)
        saved = {"dataset": "coco128", "source_url": COCO128_URL, "source_documentation": COCO128_DOC,
                 "archive_sha256": sha256_file(archive), "archive_size_bytes": archive.stat().st_size,
                 "records": _dataset_records(staging / "coco128"), "pretraining_overlap_possible": True}
        saved["excluded_missing_annotation"] = [p.stem for p in sorted((staging / "coco128" / "images" / "train2017").glob("*.jpg"))
            if not (staging / "coco128" / "labels" / "train2017" / (p.stem + ".txt")).is_file()]
        _json(staging / "manifest.json", saved)
        # Move only this verified newly created staging directory into the cache.
        staging.replace(cache)
    return cache, saved


def _known_coco8_images() -> tuple[set[str], list[str]]:
    """Known local training/validation images, without accepting user paths."""
    roots = [Path("D:/deeplearning/ultralytics-8.3.163/datasets/coco8"), PROJECT / "datasets" / "coco8"]
    identifiers, sources = set(), []
    for directory in roots:
        if directory.is_dir():
            sources.append(str(directory))
            for split in ("train", "val"):
                for image in (directory / "images" / split).glob("*.jpg"):
                    if image.stem.isdecimal() and len(image.stem) == 12:
                        identifiers.add(image.stem)
    return identifiers, sources


def _split_ids(ids: list[str]) -> dict[str, list[str]]:
    ordered = sorted(ids, key=lambda value: hashlib.sha256(f"{SPLIT_SEED}:{value}".encode()).hexdigest())
    if len(ordered) < 20 or len(set(ordered)) != len(ordered):
        raise ValueError("insufficient or duplicate images for the registered selection/evaluation protocol")
    middle = len(ordered) // 2
    return {"selection": ordered[:middle], "evaluation": ordered[middle:]}


def prepare_yolo_data(root: Path | str, *, cancelled=None) -> dict:
    root = Path(root).resolve()
    directory = root / "experiments"
    saved_path = directory / "data_preparation.json"
    source_path = directory / "yolo_runner_source.py"
    if saved_path.exists() or source_path.exists():
        verify_runner_source(root)
    directory.mkdir(parents=True, exist_ok=True)
    if saved_path.is_file():
        saved = json.loads(saved_path.read_text(encoding="utf-8"))
        if saved.get("ok"):
            _verify(root, saved["artifacts"])
            return {**saved, "reused": True, "manifest": artifact(saved_path, "data_preparation_manifest")}
    _check_cancel(cancelled)
    weights = directory / "weights" / "best.pt"
    if not weights.exists():
        original = PROJECT / "assets" / "models" / "best.pt"
        if not original.is_file() or not original.resolve().is_relative_to(PROJECT):
            raise ValueError("the registered owned best.pt checkpoint is unavailable")
        weights.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original, weights)
    weights = _inside(root, weights)
    cache, manifest = _cache_dataset(cancelled)
    known, known_sources = _known_coco8_images()
    excluded = sorted(known & {record["image_id"] for record in manifest["records"]})
    splits = _split_ids([record["image_id"] for record in manifest["records"] if record["image_id"] not in known])
    destination = directory / "dataset"
    items = [artifact(weights, "fixed_model_weights")]
    records = []
    for record in manifest["records"]:
        if record["image_id"] in excluded:
            continue
        _check_cancel(cancelled)
        split = "selection" if record["image_id"] in splits["selection"] else "evaluation"
        target = {"image": destination / "images" / split / (record["image_id"] + ".jpg"),
                  "label": destination / "labels" / split / (record["image_id"] + ".txt")}
        for field in ("image", "label"):
            path = target[field]
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists() and sha256_file(path) != record[field + "_sha256"]:
                raise ValueError("an existing dataset snapshot has an evidence hash mismatch")
            if not path.exists():
                shutil.copy2(cache / "coco128" / record[field], path)
            if sha256_file(path) != record[field + "_sha256"]:
                raise ValueError("dataset snapshot copy failed its evidence hash check")
            items.append(artifact(path, "dataset_image" if field == "image" else "dataset_annotation"))
        records.append({**record, "split": split, "image": str(target["image"].resolve()), "label": str(target["label"].resolve())})
    for split in splits:
        # JSON is valid YAML. No download script or remote path is in this config.
        yaml = directory / f"{split}.yaml"
        config = {"path": str(destination), "train": f"images/{split}", "val": f"images/{split}", "names": dict(enumerate(COCO_NAMES))}
        _json(yaml, config)
        items.append(artifact(yaml, "fixed_dataset_yaml"))
    data_manifest = directory / "dataset_manifest.json"
    _json(data_manifest, {**manifest, "records": records, "excluded_coco8": excluded})
    items.append(artifact(data_manifest, "dataset_manifest"))
    protocol = {"dataset": "coco128", "source_url": COCO128_URL, "source_documentation": COCO128_DOC,
                "dataset_manifest_sha256": sha256_file(data_manifest), "archive_sha256": manifest["archive_sha256"],
                "split_seed": SPLIT_SEED, "splits": splits, "counts": {key: len(values) for key, values in splits.items()},
                "excluded_coco8": excluded, "excluded_missing_annotation": manifest.get("excluded_missing_annotation", []),
                "annotation_policy": "Exclude missing annotation files rather than assume background or fabricate labels",
                "local_coco8_sources": known_sources, "pretraining_overlap_possible": True,
                "independent_test": False, "selection_evaluation_disjoint": True, "training_fits": 0,
                "weights": {"path": str(weights), "sha256": sha256_file(weights)}, "limitations": LIMITATIONS}
    protocol_path = directory / "data_protocol.json"
    _json(protocol_path, protocol)
    items.append(artifact(protocol_path, "data_protocol"))
    if not source_path.exists():
        shutil.copy2(Path(__file__), source_path)
    verify_runner_source(root)
    items.append(artifact(source_path, "registered_runner_snapshot"))
    result = {"ok": True, "status": "completed", "domain": "yolo_tradeoff", **protocol,
              "test_opened": False, "evaluation_opened": False, "artifacts": items, "reused": False}
    _json(saved_path, result)
    return {**result, "manifest": artifact(saved_path, "data_preparation_manifest")}


def _environment(root: Path) -> dict:
    import torch
    import ultralytics
    import cv2
    cuda = torch.cuda.is_available()
    path = root / "experiments" / "environment.json"
    current = {"python_version": platform.python_version(), "platform": platform.platform(), "torch_version": torch.__version__,
               "ultralytics_version": ultralytics.__version__, "opencv_version": cv2.__version__,
               "cuda_version": torch.version.cuda, "device": "0" if cuda else "cpu",
               "device_name": torch.cuda.get_device_name(0) if cuda else platform.processor(), "precision": "FP32",
               "batch_size": 1, "rect": False, "warmups": WARMUPS, "repeats": REPEATS, "samples_per_repeat": SAMPLES_PER_REPEAT,
               "cpu_threads": CPU_THREADS, "confidence_threshold": 0.001, "nms_iou": 0.7, "max_det": 300,
               "latency_includes": ["preprocessing", "inference", "postprocessing", "Python dispatch"],
               "latency_excludes": ["model loading", "image file I/O", "image decoding"], "gpu_synchronized": cuda,
               "tf32_enabled": False, "training_fits": 0, "model_weights": "best.pt",
               "weights_sha256": sha256_file(root / "experiments" / "weights" / "best.pt")}
    if path.exists():
        if json.loads(path.read_text(encoding="utf-8")) != current:
            raise ValueError("resuming this run on a different recorded environment is disallowed; start a new run")
    else:
        _json(path, current)
    return current


def _validate_metrics(values: dict) -> dict:
    if set(values) != {"map50", "map50_95", "precision", "recall"}:
        raise ValueError("unexpected accuracy-metric schema")
    if any(isinstance(value, bool) or not math.isfinite(float(value)) or not 0 <= float(value) <= 1 for value in values.values()):
        raise ValueError("YOLO accuracy metric is not a finite fraction in [0,1]")
    return {key: float(value) for key, value in values.items()}


def summarize_samples(row: dict, samples: list[dict], protocol: dict) -> dict:
    """Recompute latency from raw frames, rejecting missing, repeated or leaked data."""
    split, size = row["split"], int(row["imgsz"])
    if split not in ("selection", "evaluation") or size not in IMAGE_SIZES:
        raise ValueError("unregistered YOLO job")
    if len(samples) != REPEATS * SAMPLES_PER_REPEAT:
        raise ValueError("each completed job needs exactly thirty latency measurements")
    identifiers = set(protocol["splits"][split])
    keys, latencies = set(), []
    for sample in samples:
        if (sample["split"] != split or int(sample["imgsz"]) != size or sample["model"] != f"yolo_imgsz{size}"
                or sample["image_id"] not in identifiers):
            raise ValueError("latency sample leaked across a split or differs from its registered job")
        repeat, index = int(sample["repeat"]), int(sample["sample"])
        if repeat not in range(REPEATS) or index not in range(SAMPLES_PER_REPEAT) or (repeat, index) in keys:
            raise ValueError("duplicate or invalid latency repeat/frame index")
        keys.add((repeat, index))
        latency = float(sample["latency_ms"])
        if not math.isfinite(latency) or latency <= 0:
            raise ValueError("latency must be a finite positive measured value")
        latencies.append(latency)
    accuracy = _validate_metrics({key: row[key] for key in ("map50", "map50_95", "precision", "recall")})
    mean = statistics.fmean(latencies)
    p95 = sorted(latencies)[math.ceil(len(latencies) * 0.95) - 1]
    return {"model": f"yolo_imgsz{size}", "split": split, "imgsz": size, **accuracy,
            "latency_ms": mean, "latency_sd_ms": statistics.stdev(latencies), "latency_median_ms": statistics.median(latencies),
            "latency_p95_ms": p95, "fps": 1000 / mean, "repeats": REPEATS, "sample_count": len(samples), "n_images": len(identifiers)}


def _job(root: Path, split: str, size: int, protocol: dict, environment: dict, cancelled, before_trial) -> dict:
    verify_runner_source(root)
    directory = root / "experiments" / "jobs" / f"{split}_{size}"
    directory.mkdir(parents=True, exist_ok=True)
    result_path = directory / "result.json"
    if result_path.is_file():
        saved = json.loads(result_path.read_text(encoding="utf-8"))
        if saved.get("status") == "completed":
            _verify(root, saved["artifacts"])
            with (directory / "samples.csv").open(encoding="utf-8", newline="") as stream:
                raw = list(csv.DictReader(stream))
            actual = summarize_samples(saved["metrics"], raw, protocol)
            if actual != saved["metrics"]:
                raise ValueError("completed YOLO job summary differs from raw measured frames")
            return {**saved, "reused": True, "manifest": artifact(result_path, "evaluation_job_manifest")}
    _check_cancel(cancelled)
    if before_trial:
        before_trial()
    accuracy_path, samples_path = directory / "accuracy.json", directory / "samples.csv"
    partial, values, status, error = [], {}, "running", None
    attempt = (json.loads(result_path.read_text(encoding="utf-8")).get("attempt", 0) if result_path.is_file() else 0) + 1
    # Preserve prior failed/cancelled evidence rather than silently replacing it.
    if result_path.exists():
        old = directory / f"attempt_{attempt - 1}"
        old.mkdir(exist_ok=True)
        for path in (result_path, accuracy_path, samples_path):
            if path.exists():
                shutil.copy2(path, old / path.name)
    begin = time.monotonic()
    config = {"imgsz": size, "precision": "FP32", "device": environment["device"], "split": split, "batch_size": 1, "rect": False}
    _json(result_path, {"id": f"{split}_{size}", "name": f"{split}: {size}px", "status": "running", "config": config, "attempt": attempt})
    try:
        import torch
        import cv2
        from ultralytics import YOLO
        previous_threads = torch.get_num_threads()
        previous_matmul, previous_cudnn = torch.backends.cuda.matmul.allow_tf32, torch.backends.cudnn.allow_tf32
        torch.set_num_threads(CPU_THREADS)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        try:
            model = YOLO(str(root / "experiments" / "weights" / "best.pt"))
            if model.task != "detect" or list(model.names.values()) != COCO_NAMES:
                raise ValueError("the registered checkpoint must be a COCO-80 detection model")
            model.add_callback("on_val_batch_start", lambda _: _check_cancel(cancelled))
            model.add_callback("on_predict_batch_start", lambda _: _check_cancel(cancelled))
            common = dict(imgsz=size, device=environment["device"], batch=1, half=False, rect=False, conf=0.001, iou=0.7, max_det=300,
                          augment=False, verbose=False, save=False, project=str(directory), exist_ok=True)
            measured = model.val(data=str(root / "experiments" / f"{split}.yaml"), workers=0, plots=False, save_json=False,
                                 name="accuracy", split="val", **common)
            values = _validate_metrics({"map50": measured.box.map50, "map50_95": measured.box.map,
                                        "precision": measured.box.mp, "recall": measured.box.mr})
            _json(accuracy_path, {"model": f"yolo_imgsz{size}", "split": split, "imgsz": size, **values,
                                  "ultralytics_speed_ms": measured.speed, "n_images": protocol["counts"][split]})
            _check_cancel(cancelled)
            images = []
            for identifier in protocol["splits"][split][:SAMPLES_PER_REPEAT]:
                path = root / "experiments" / "dataset" / "images" / split / (identifier + ".jpg")
                image = cv2.imread(str(path))
                if image is None:
                    raise ValueError("a registered latency image could not be decoded")
                images.append((identifier, image))
            def synchronize():
                if environment["device"] != "cpu":
                    torch.cuda.synchronize(0)
            for index in range(WARMUPS):
                _check_cancel(cancelled)
                model.predict(source=images[index % len(images)][1], name="latency", **common)
                synchronize()
            for repeat in range(REPEATS):
                for index in range(SAMPLES_PER_REPEAT):
                    _check_cancel(cancelled)
                    identifier, image = images[index % len(images)]
                    synchronize()
                    started = time.perf_counter_ns()
                    model.predict(source=image, name="latency", **common)
                    synchronize()
                    partial.append({"model": f"yolo_imgsz{size}", "split": split, "imgsz": size, "repeat": repeat,
                                    "sample": index, "image_id": identifier, "latency_ms": (time.perf_counter_ns() - started) / 1e6})
                    _csv(samples_path, partial, SAMPLE_FIELDS)
            status = "completed"
        finally:
            torch.set_num_threads(previous_threads)
            torch.backends.cuda.matmul.allow_tf32 = previous_matmul
            torch.backends.cudnn.allow_tf32 = previous_cudnn
    except YoloCancelled as exc:
        status, error = "cancelled", str(exc)
    except Exception as exc:
        status, error = "failed", f"{type(exc).__name__}: {exc}"
    _csv(samples_path, partial, SAMPLE_FIELDS)
    items = [artifact(samples_path, "raw_latency_job_csv")]
    if accuracy_path.exists():
        items.append(artifact(accuracy_path, "raw_accuracy_job_json"))
    metrics = summarize_samples({"split": split, "imgsz": size, **values}, partial, protocol) if status == "completed" else values
    result = {"id": f"{split}_{size}", "name": f"{split}: {size}px", "status": status, "config": config,
              "metrics": metrics, "error": error, "attempt": attempt, "duration_seconds": time.monotonic() - begin,
              "training_fits": 0, "artifacts": items, "reused": False}
    _json(result_path, result)
    return {**result, "manifest": artifact(result_path, "evaluation_job_manifest")}


def _completed_jobs(root: Path, protocol: dict) -> list[dict]:
    jobs = []
    for path in sorted((root / "experiments" / "jobs").glob("*/result.json")):
        saved = json.loads(path.read_text(encoding="utf-8"))
        if saved.get("status") == "completed":
            _verify(root, saved["artifacts"])
            with (path.parent / "samples.csv").open(encoding="utf-8", newline="") as stream:
                samples = list(csv.DictReader(stream))
            if summarize_samples(saved["metrics"], samples, protocol) != saved["metrics"]:
                raise ValueError("completed YOLO metrics differ from raw samples")
            jobs.append({**saved, "manifest": artifact(path, "evaluation_job_manifest")})
    return jobs


def select_candidate(selection: list[dict]) -> int:
    if len(selection) != 3 or {row["imgsz"] for row in selection} != set(IMAGE_SIZES) or any(row["split"] != "selection" for row in selection):
        raise ValueError("selection requires exactly the three declared sizes on selection images")
    baseline = next(row for row in selection if row["imgsz"] == BASELINE_SIZE)
    eligible = [row for row in selection if row["map50_95"] >= baseline["map50_95"] - 0.02 - 1e-12]
    return min(eligible, key=lambda row: (row["latency_ms"], -row["map50_95"], row["imgsz"]))["imgsz"]


def _freeze(root: Path, jobs: list[dict]) -> dict:
    selection = sorted((job["metrics"] for job in jobs if job["config"]["split"] == "selection"), key=lambda row: row["imgsz"])
    frozen = {"selected_imgsz": select_candidate(selection), "baseline_imgsz": BASELINE_SIZE,
              "rule": "Retain sizes whose selection mAP50-95 is no more than 0.02 below 640px; choose min(latency_ms, -map50_95, imgsz).",
              "map50_95_tolerance": 0.02, "selection": selection, "frozen_before_evaluation": True,
              "independent_test": False, "selection_artifacts": [job["manifest"] for job in jobs if job["config"]["split"] == "selection"]}
    path = root / "experiments" / "frozen_selection.json"
    if path.exists():
        if json.loads(path.read_text(encoding="utf-8")) != frozen:
            raise ValueError("frozen selection differs from its original measured data")
    else:
        if any(job["config"]["split"] == "evaluation" for job in jobs):
            raise ValueError("cannot freeze selection after evaluation data were opened")
        _json(path, frozen)
    return frozen


def _plot(root: Path, summary: list[dict], selected: int) -> Path:
    from matplotlib.figure import Figure
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    figure = Figure(figsize=(8.5, 4.8), constrained_layout=True)
    FigureCanvasAgg(figure)
    axes = figure.subplots()
    for split, marker in (("selection", "o"), ("evaluation", "s")):
        rows = sorted((row for row in summary if row["split"] == split), key=lambda row: row["imgsz"])
        axes.plot([row["latency_ms"] for row in rows], [row["map50_95"] for row in rows], marker=marker, label=split)
        for row in rows:
            axes.annotate(f"{row['imgsz']}px" + (" selected" if row["imgsz"] == selected else ""),
                          (row["latency_ms"], row["map50_95"]), xytext=(5, 6), textcoords="offset points", fontsize=9)
    axes.set(xlabel="End-to-end prediction latency (ms/image; mean of 30 samples)", ylabel="mAP50-95 (fraction)",
             title="Fixed-checkpoint resolution trade-off on COCO128 training samples")
    axes.grid(alpha=0.2)
    axes.legend()
    path = root / "experiments" / "accuracy_latency.png"
    figure.savefig(path, dpi=150)
    return path


def run_yolo_phase(root: Path | str, *, phase="baseline", cancelled=None, before_trial=None) -> dict:
    if phase not in ("baseline", "search", "confirmation"):
        raise ValueError("unregistered YOLO phase")
    root = Path(root).resolve()
    prepared = prepare_yolo_data(root, cancelled=cancelled)
    verify_runner_source(root)
    protocol = json.loads((root / "experiments" / "data_protocol.json").read_text(encoding="utf-8"))
    environment = _environment(root)
    phase_path = root / "experiments" / f"yolo_{phase}.json"
    if phase_path.exists():
        saved = json.loads(phase_path.read_text(encoding="utf-8"))
        if saved.get("ok"):
            _verify(root, saved["artifacts"])
            _completed_jobs(root, protocol)
            return {**saved, "reused": True, "manifest": artifact(phase_path, "experiment_phase_manifest")}
    jobs = _completed_jobs(root, protocol)
    frozen = None
    if phase == "search" and not any(job["config"]["split"] == "selection" and job["config"]["imgsz"] == BASELINE_SIZE for job in jobs):
        raise ValueError("run the fixed 640px selection baseline before candidate search")
    if phase == "confirmation":
        if not (root / "experiments" / "frozen_selection.json").is_file():
            raise ValueError("evaluation is forbidden before selection has been frozen")
        frozen = _freeze(root, jobs)
    planned = [("selection", 640)] if phase == "baseline" else [("selection", 320), ("selection", 480)] if phase == "search" else [("evaluation", size) for size in sorted({640, frozen["selected_imgsz"]})]
    status, error, evaluation_opened = "completed", None, any(job["config"]["split"] == "evaluation" for job in jobs)
    executed = []
    try:
        for split, size in planned:
            _check_cancel(cancelled)
            job = _job(root, split, size, protocol, environment, cancelled, before_trial)
            executed.append(job)
            if split == "evaluation":
                evaluation_opened = True
            if job["status"] != "completed":
                status, error = job["status"], job["error"]
                break
        jobs = _completed_jobs(root, protocol)
        if status == "completed" and phase == "search":
            frozen = _freeze(root, jobs)
    except YoloCancelled as exc:
        status, error = "cancelled", str(exc)
    except Exception as exc:
        status, error = "failed", f"{type(exc).__name__}: {exc}"
    summary = sorted((job["metrics"] for job in jobs), key=lambda row: (row["split"], row["imgsz"]))
    items = list(prepared["artifacts"]) + [prepared["manifest"], artifact(root / "experiments" / "environment.json", "execution_environment")]
    # Each stage registers immutable job evidence, never a later-mutated aggregate.
    for job in jobs:
        items.extend(job["artifacts"] + [job["manifest"]])
    if frozen:
        items.append(artifact(root / "experiments" / "frozen_selection.json", "frozen_selection"))
    if phase == "confirmation":
        metrics_path = root / "experiments" / "metrics.csv"
        _csv(metrics_path, summary, METRIC_FIELDS)
        samples = []
        for job in jobs:
            path = Path(job["artifacts"][0]["path"])
            with path.open(encoding="utf-8", newline="") as stream:
                samples.extend(csv.DictReader(stream))
        latency_path = root / "experiments" / "latency_samples.csv"
        _csv(latency_path, samples, SAMPLE_FIELDS)
        alias = root / "experiments" / "samples.csv"
        shutil.copy2(latency_path, alias)
        items.extend([artifact(metrics_path, "raw_metrics_csv"), artifact(latency_path, "raw_latency_csv"), artifact(alias, "raw_latency_csv_alias")])
        if status == "completed":
            items.append(artifact(_plot(root, summary, frozen["selected_imgsz"]), "accuracy_latency_figure"))
    # Failed/cancelled jobs and partial frames remain registered and visible.
    for job in executed:
        if job["status"] != "completed":
            items.extend(job["artifacts"] + [job["manifest"]])
    unique = {item["path"]: item for item in items}
    result = {"domain": "yolo_tradeoff", "ok": status == "completed", "status": status, "phase": phase, "error": error,
              "test_opened": False, "evaluation_opened": evaluation_opened, "independent_test": False, "training_fits": 0,
              "evaluation_jobs_completed": len(jobs), "recipe": {"image_sizes": list(IMAGE_SIZES), "precision": "FP32", "batch_size": 1},
              "selected_imgsz": frozen["selected_imgsz"] if frozen else None, "baseline_imgsz": BASELINE_SIZE,
              "summary": summary, "trials": jobs + [job for job in executed if job["status"] != "completed"],
              "environment": environment, "data_protocol": protocol, "frozen_selection": frozen,
              "latency_samples_path": str(root / "experiments" / "latency_samples.csv") if phase == "confirmation" else None,
              "limitations": LIMITATIONS, "artifacts": list(unique.values()), "reused": False}
    _json(phase_path, result)
    return {**result, "manifest": artifact(phase_path, "experiment_phase_manifest")}


def main() -> int:
    parser = argparse.ArgumentParser(description="Fixed-weight YOLO resolution study; COCO128 is not independent test data")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phase", choices=("prepare", "baseline", "search", "confirmation", "all"), default="all")
    args = parser.parse_args()
    phases = ("baseline", "search", "confirmation") if args.phase == "all" else (args.phase,)
    for phase in phases:
        result = prepare_yolo_data(args.output) if phase == "prepare" else run_yolo_phase(args.output, phase=phase)
        print(json.dumps({key: result.get(key) for key in ("domain", "phase", "status", "error", "selected_imgsz", "evaluation_jobs_completed", "independent_test")}, ensure_ascii=False))
        if not result["ok"]:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
