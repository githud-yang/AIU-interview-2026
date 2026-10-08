"""One inference worker owns its source; browsers share fresh JPEG frames."""
from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import os
from pathlib import Path
import threading
import time

from src.yolo.sources import FrameSource, resolve_source, source_options

ROOT = Path(__file__).resolve().parents[3]


class YoloProcessManager:
    def __init__(self, *, join_timeout: float = 5.0):
        self._thread = None
        self._stop = threading.Event()
        self._condition = threading.Condition()
        self._control = threading.Lock()
        self._join_timeout = join_timeout
        self.frame = None
        self.error = ""
        self._state = "stopped"
        self._msg = "检测未启动"
        self._warning = ""
        self._source = None
        self._model_name = ""
        self._frame_count = 0
        self._frame_times = deque(maxlen=30)
        self._started_at = None
        self._last_frame_at = None

    @property
    def is_running(self):
        with self._condition:
            return self._state in {"starting", "running"} and not self._stop.is_set()

    def sources(self):
        return source_options(ROOT)

    def status(self):
        with self._condition:
            fps = 0.0
            if self._state == "running" and len(self._frame_times) > 1:
                duration = self._frame_times[-1] - self._frame_times[0]
                if duration > 0:
                    fps = (len(self._frame_times) - 1) / duration
            return {
                "running": self._state in {"starting", "running"} and not self._stop.is_set(),
                "state": self._state, "msg": self._msg, "error": self.error,
                "warning": self._warning,
                "source": self._source.id if self._source else None,
                "source_label": self._source.label if self._source else "",
                "model": self._model_name, "frame_count": self._frame_count,
                "fps": round(fps, 2), "started_at": self._started_at,
                "last_frame_at": self._last_frame_at,
            }

    def _response(self, ok):
        return {"ok": ok, **self.status()}

    def _load_model(self, weights):
        from ultralytics import YOLO
        return YOLO(str(weights))

    def _open_source(self, spec):
        return FrameSource(spec)

    def start(self, source=None):
        with self._control:
            if self.is_running:
                current = self.status()["source"]
                if source and source != current:
                    return {**self._response(False), "msg": "请先停止当前检测，再切换来源"}
                return {**self._response(True), "msg": "检测已经在启动或运行"}
            if self._thread and self._thread.is_alive():
                return {**self._response(False), "msg": "正在释放视频来源，请稍后重试"}
            try:
                spec = resolve_source(source, ROOT)
                weights = Path(os.getenv("YOLO_WEIGHTS", "assets/models/best.pt")).expanduser()
                if not weights.is_absolute():
                    weights = ROOT / weights
                if not weights.is_file():
                    raise ValueError("缺少训练权重，请先执行 src/yolo/train.py")
                conf = float(os.getenv("YOLO_CONF", "0.25"))
                if not 0 <= conf <= 1:
                    raise ValueError("YOLO_CONF 必须在 0 到 1 之间")
            except (ValueError, OSError) as exc:
                with self._condition:
                    self._state = "error"
                    self.error = str(exc)
                    self._msg = "检测启动失败"
                    self.frame = None
                    self._condition.notify_all()
                return self._response(False)

            with self._condition:
                self._stop.clear()
                self._state = "starting"
                self._msg = "正在加载模型和视频来源"
                self.error = self._warning = ""
                self.frame = None
                self._source = spec
                self._model_name = weights.name
                self._frame_count = 0
                self._frame_times.clear()
                self._started_at = datetime.now(timezone.utc).isoformat()
                self._last_frame_at = None
            self._thread = threading.Thread(
                target=self._run, args=(spec, weights, conf), name="yolo-inference", daemon=True
            )
            self._thread.start()
            return self._response(True)

    def _run(self, spec, weights, conf):
        source = None
        try:
            import cv2
            model = self._load_model(weights)
            if self._stop.is_set():
                return
            source = self._open_source(spec)
            with self._condition:
                if self._stop.is_set():
                    return
                self._state = "running"
                self._msg = "检测正在运行"
                self._condition.notify_all()
            while not self._stop.is_set():
                raw = source.read()
                if raw is None:
                    with self._condition:
                        self._state = "finished"
                        self._msg = "本地视频播放完毕"
                    break
                warning = "画面接近全黑，请检查摄像头遮挡、隐私开关或光照；可切换公开样例演示" if raw.mean() < 2 else ""
                result = model(raw, conf=conf, verbose=False)[0]
                ok, jpeg = cv2.imencode(".jpg", result.plot(), [cv2.IMWRITE_JPEG_QUALITY, 85])
                if not ok:
                    raise RuntimeError("检测画面 JPEG 编码失败")
                with self._condition:
                    if self._stop.is_set():
                        break
                    self.frame = jpeg.tobytes()
                    self._frame_count += 1
                    self._frame_times.append(time.monotonic())
                    self._last_frame_at = datetime.now(timezone.utc).isoformat()
                    self._warning = warning
                    self._condition.notify_all()
                if spec.frame_interval:
                    self._stop.wait(spec.frame_interval)
        except Exception as exc:
            with self._condition:
                if not self._stop.is_set():
                    self.error = f"{type(exc).__name__}: {exc}"
                    self._state = "error"
                    self._msg = "检测失败，请查看错误并重新启动"
                    self.frame = None
        finally:
            try:
                if source is not None:
                    source.close()
            except Exception as exc:
                with self._condition:
                    self.error = self.error or f"视频来源释放失败: {exc}"
                    self._state = "error"
                    self._msg = "视频来源释放失败"
            finally:
                with self._condition:
                    self._stop.set()
                    if self._state in {"starting", "running", "stopping"}:
                        self._state = "stopped"
                        self._msg = "检测已停止，视频来源已释放"
                        self.frame = None
                    self._condition.notify_all()

    def stop(self):
        with self._control:
            with self._condition:
                self._stop.set()
                if self._thread and self._thread.is_alive():
                    self._state = "stopping"
                    self._msg = "正在停止检测和释放视频来源"
                self.frame = None
                self._warning = ""
                self._condition.notify_all()
            if self._thread and self._thread.is_alive():
                self._thread.join(timeout=self._join_timeout)
                if self._thread.is_alive():
                    return {**self._response(False), "msg": "推理尚未退出，正在等待视频来源释放；请稍后重试"}
            with self._condition:
                if self._state != "error":
                    self._state = "stopped"
                    self._msg = "检测已停止，视频来源已释放"
                self._condition.notify_all()
            return self._response(True)

    def frames(self):
        """Wait for a new frame, never spin or send the same frame repeatedly."""
        seen = 0
        while True:
            with self._condition:
                self._condition.wait_for(
                    lambda: self._frame_count > seen or self._state not in {"starting", "running"},
                    timeout=1.0,
                )
                if self._state not in {"starting", "running"}:
                    if self._state == "finished" and self._frame_count > seen and self.frame is not None:
                        frame = self.frame
                        seen = self._frame_count
                    else:
                        return
                elif self._frame_count <= seen or self.frame is None:
                    continue
                else:
                    seen = self._frame_count
                    frame = self.frame
            yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(frame)).encode() + b"\r\n\r\n" + frame + b"\r\n"
