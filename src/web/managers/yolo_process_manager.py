"""单个后台推理线程共享最新帧，启停与网页视频流使用同一摄像头。"""
import os
import threading
import time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]

class YoloProcessManager:
    def __init__(self):
        self._thread = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._control = threading.Lock()
        self.frame = None
        self.error = ""

    @property
    def is_running(self):
        return self._thread is not None and self._thread.is_alive() and not self._stop.is_set()

    def start(self):
        with self._control:
            if self.is_running: return {"ok": True, "msg": "检测已经在运行"}
            if self._thread and self._thread.is_alive(): return {"ok": False, "msg": "正在释放摄像头，请稍后重试"}
            weights = Path(os.getenv("YOLO_WEIGHTS", "assets/models/best.pt"))
            if not weights.is_absolute(): weights = ROOT / weights
            if not weights.is_file(): return {"ok": False, "msg": "缺少训练权重，请先执行 src/yolo/train.py"}
            try:
                import cv2
                from ultralytics import YOLO
                model = YOLO(str(weights))
                cap = cv2.VideoCapture(int(os.getenv("YOLO_CAMERA", "0")))
                if not cap.isOpened():
                    cap.release()
                    return {"ok": False, "msg": "无法打开摄像头，请检查设备和系统权限"}
            except Exception as exc:
                return {"ok": False, "msg": str(exc)}
            self._stop.clear()
            self.error = ""
            self.frame = None
            def run():
                try:
                    while not self._stop.is_set():
                        ok, frame = cap.read()
                        if not ok: raise RuntimeError("摄像头读取失败")
                        if frame.mean() < 2:
                            self.error = "摄像头画面接近全黑，请检查遮挡、隐私开关或光照"
                        else:
                            self.error = ""
                        result = model(frame, verbose=False)[0]
                        ok, jpeg = cv2.imencode(".jpg", result.plot())
                        if ok:
                            with self._lock: self.frame = jpeg.tobytes()
                except Exception as exc: self.error = str(exc)
                finally:
                    cap.release()
                    self._stop.set()
            self._thread = threading.Thread(target=run, daemon=True)
            self._thread.start()
            return {"ok": True, "msg": "检测已启动"}

    def stop(self):
        with self._control:
            self._stop.set()
            if self._thread: self._thread.join(timeout=5)
            with self._lock: self.frame = None
            return {"ok": True, "msg": "已发送停止指令"}

    def frames(self):
        while self.is_running:
            with self._lock: frame = self.frame
            if frame:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            time.sleep(0.05)
