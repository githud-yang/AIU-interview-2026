"""Local camera/video/public-image sources shared by Web and CLI."""
from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import os
from pathlib import Path


@dataclass(frozen=True)
class SourceSpec:
    id: str
    label: str
    kind: str
    value: str | int
    loop: bool = False
    frame_interval: float = 0.0


def public_sample_path():
    package = importlib.util.find_spec("ultralytics")
    if not package or not package.origin:
        raise ValueError("公开样例需要安装 requirements-yolo.txt 中的 ultralytics")
    path = Path(package.origin).parent / "assets" / "bus.jpg"
    if not path.is_file():
        raise ValueError("当前 ultralytics 安装中缺少公开 bus.jpg 样例")
    return path


def local_path(value, root):
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = root / path
    if not path.is_file():
        raise ValueError("配置的本地视频或图片不存在，请检查 YOLO_VIDEO")
    return path.resolve()


def resolve_source(selector, root):
    selector = selector or os.getenv("YOLO_SOURCE", "camera")
    if selector == "camera":
        try:
            camera = int(os.getenv("YOLO_CAMERA", "0"))
        except ValueError as exc:
            raise ValueError("YOLO_CAMERA 必须是非负摄像头编号") from exc
        if camera < 0:
            raise ValueError("YOLO_CAMERA 必须是非负摄像头编号")
        return SourceSpec("camera", f"本地摄像头 {camera}", "camera", camera)
    if selector == "demo":
        return SourceSpec("demo", "公开 bus.jpg 静态样例", "image", str(public_sample_path()), frame_interval=0.25)
    if selector == "video":
        value = os.getenv("YOLO_VIDEO", "")
        if not value:
            raise ValueError("请先在服务器配置 YOLO_VIDEO 本地视频路径")
        path = local_path(value, root)
        kind = "image" if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"} else "video"
        return SourceSpec("video", f"本地文件：{path.name}", kind, str(path), loop=os.getenv("YOLO_VIDEO_LOOP", "0") == "1", frame_interval=0.25 if kind == "image" else 0.0)
    raise ValueError("来源必须是 camera、demo 或 video；本地路径由服务器配置")


def source_options(root):
    options = []
    for selector, label in [("camera", "本地摄像头"), ("demo", "公开静态样例（bus.jpg）"), ("video", "服务器配置的本地文件")]:
        try:
            resolve_source(selector, root)
            available, msg = True, ""
        except (ValueError, OSError) as exc:
            available, msg = False, str(exc)
        options.append({"id": selector, "label": label, "available": available, "msg": msg})
    default = os.getenv("YOLO_SOURCE", "camera")
    return {"default": default if default in {"camera", "demo", "video"} else "camera", "sources": options}


class FrameSource:
    def __init__(self, spec):
        import cv2
        self.spec = spec
        self._cv2 = cv2
        self._cap = None
        self._image = None
        self._reads = 0
        if spec.kind == "image":
            import numpy as np
            # OpenCV filename APIs do not reliably accept Unicode paths on Windows.
            self._image = cv2.imdecode(np.frombuffer(Path(spec.value).read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
            if self._image is None:
                raise RuntimeError("无法解码本地样例图片")
        else:
            self._cap = cv2.VideoCapture(spec.value)
            try:
                if not self._cap.isOpened():
                    raise RuntimeError("无法打开摄像头或视频，请检查设备、系统权限和文件格式；本地视频可复制到纯英文路径重试")
                if spec.kind == "camera":
                    self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                self._cap.release()
                self._cap = None
                raise

    def read(self):
        if self._image is not None:
            return self._image.copy()
        ok, frame = self._cap.read()
        if ok:
            self._reads += 1
            return frame
        if self.spec.kind == "video":
            if not self._reads:
                raise RuntimeError("本地视频没有可解码帧，请检查文件格式或文件是否损坏")
            if self.spec.loop:
                self._cap.set(self._cv2.CAP_PROP_POS_FRAMES, 0)
                ok, frame = self._cap.read()
                if ok:
                    return frame
                raise RuntimeError("视频无法重新播放，文件可能没有可解码帧")
            return None
        raise RuntimeError("摄像头读取失败，请检查设备连接或切换公开样例")

    def close(self):
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        self._image = None
