"""
YOLO相关路由
============
负责YOLO页面访问、进程控制和视频流推送，所有操作委托给进程管理器。
"""
from __future__ import annotations

import cv2
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from pathlib import Path

from src.web.managers.yolo_process_manager import YoloProcessManager

router = APIRouter()
yolo_manager = YoloProcessManager()

# 模型路径配置
project_root = Path(__file__).resolve().parents[3]
TRAINED_WEIGHTS = project_root / "yolo" / "runs" / "detect" / "coco8_baseline" / "weights" / "best.pt"
DEFAULT_WEIGHTS = project_root / "assets" / "models" / "yolo11n.pt"


def _generate_frames():
    """生成MJPEG视频流帧"""
    from ultralytics import YOLO

    weights = str(TRAINED_WEIGHTS) if TRAINED_WEIGHTS.exists() else str(DEFAULT_WEIGHTS)
    model = YOLO(weights)
    cap = cv2.VideoCapture(0)

    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            results = model(frame, verbose=False)
            buf = cv2.imencode(".jpg", results[0].plot())[1].tobytes()
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf + b"\r\n"
            )
    finally:
        cap.release()


@router.get("/yolo", response_class=HTMLResponse)
async def yolo_page(request: Request):
    """YOLO演示页面"""
    templates = request.app.state.templates
    return templates.TemplateResponse(request, "yolo.html")


@router.post("/yolo/start")
async def yolo_start():
    """启动YOLO摄像头检测"""
    return yolo_manager.start()


@router.post("/yolo/stop")
async def yolo_stop():
    """停止YOLO摄像头检测"""
    return yolo_manager.stop()


@router.get("/yolo/stream")
async def yolo_stream():
    """返回MJPEG视频流"""
    return StreamingResponse(
        _generate_frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
