from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from typing import Literal
from src.web.managers.yolo_process_manager import YoloProcessManager
router = APIRouter()
yolo_manager = YoloProcessManager()

class StartRequest(BaseModel):
    source: Literal["camera", "demo", "video"] | None = None

@router.get("/yolo", response_class=HTMLResponse)
def yolo_page(request: Request):
    return request.app.state.templates.TemplateResponse(request=request, name="yolo.html")

@router.post("/yolo/start")
def yolo_start(options: StartRequest | None = None):
    return yolo_manager.start(options.source if options else None)

@router.post("/yolo/stop")
def yolo_stop(): return yolo_manager.stop()

@router.get("/yolo/status")
def yolo_status(): return yolo_manager.status()

@router.get("/yolo/sources")
def yolo_sources(): return yolo_manager.sources()

@router.get("/yolo/stream")
def yolo_stream():
    if not yolo_manager.is_running: raise HTTPException(409, "请先启动检测")
    return StreamingResponse(yolo_manager.frames(), media_type="multipart/x-mixed-replace; boundary=frame", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
