"""Local camera, image or video inference; q/Escape exits the optional window."""
import argparse
import json
from pathlib import Path
import time

if __package__:
    from .sources import FrameSource, SourceSpec, local_path, resolve_source
else:
    from sources import FrameSource, SourceSpec, local_path, resolve_source

ROOT = Path(__file__).resolve().parents[2]


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--weights", default=str(ROOT / "assets/models/best.pt"))
    p.add_argument("--source", default="0", help="camera index, demo, or local video/image path")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--device", default="", help="empty uses Ultralytics default; cpu or GPU index")
    p.add_argument("--headless", action="store_true", help="do not open a desktop window")
    p.add_argument("--max-frames", type=int, default=0, help="0 means unlimited")
    p.add_argument("--save", type=Path, help="save the final annotated frame locally")
    return p


def main():
    p = parser()
    a = p.parse_args()
    weights = Path(a.weights).expanduser()
    if not weights.is_absolute():
        weights = ROOT / weights
    if not weights.is_file():
        p.error("权重不存在，请先运行 train.py")
    if not 0 <= a.conf <= 1 or a.max_frames < 0:
        p.error("conf 必须在 0 到 1 之间，max-frames 必须为非负数")
    try:
        if a.source == "demo":
            spec = resolve_source("demo", ROOT)
        elif a.source.isdigit():
            spec = SourceSpec("camera", f"摄像头 {a.source}", "camera", int(a.source))
        else:
            path = local_path(a.source, ROOT)
            kind = "image" if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"} else "video"
            spec = SourceSpec("file", path.name, kind, str(path))
        import cv2
        from ultralytics import YOLO
        model = YOLO(str(weights))
        source = FrameSource(spec)
    except (ValueError, ImportError, RuntimeError, OSError) as exc:
        p.error(str(exc))
    count = 0
    detections = []
    annotated = None
    started = time.monotonic()
    try:
        while True:
            frame = source.read()
            if frame is None:
                break
            args = {"conf": a.conf, "verbose": False}
            if a.device:
                args["device"] = a.device
            result = model(frame, **args)[0]
            annotated = result.plot()
            detections = [
                {"class": model.names[int(cls)], "confidence": round(float(score), 4)}
                for cls, score in zip(result.boxes.cls.tolist(), result.boxes.conf.tolist())
            ]
            count += 1
            if not a.headless:
                cv2.imshow("AIU YOLO", annotated)
                if cv2.waitKey(1) & 0xFF in {ord("q"), 27}:
                    break
            if (a.max_frames and count >= a.max_frames) or (a.headless and spec.kind == "image"):
                break
            if spec.frame_interval:
                time.sleep(spec.frame_interval)
        if a.save and annotated is not None:
            a.save.parent.mkdir(parents=True, exist_ok=True)
            ok, encoded = cv2.imencode(a.save.suffix or ".jpg", annotated)
            if not ok:
                raise RuntimeError("无法保存标注图片")
            a.save.write_bytes(encoded.tobytes())
    except KeyboardInterrupt:
        pass
    finally:
        source.close()
        if not a.headless:
            cv2.destroyAllWindows()
    duration = time.monotonic() - started
    print(json.dumps({"source": spec.label, "frames": count, "elapsed_seconds": round(duration, 3),
                      "fps": round(count / duration, 2) if duration else 0, "last_frame_detections": detections,
                      "saved": str(a.save.resolve()) if a.save and annotated is not None else None}, ensure_ascii=False))


if __name__ == "__main__":
    main()
