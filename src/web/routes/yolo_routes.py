from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse, StreamingResponse
from src.web.managers.yolo_process_manager import YoloProcessManager
router = APIRouter()
yolo_manager = YoloProcessManager()

@router.get("/yolo", response_class=HTMLResponse)
def yolo_page(request: Request):
    return request.app.state.templates.TemplateResponse(request=request, name="yolo.html")

@router.post("/yolo/start")
def yolo_start(): return yolo_manager.start()

@router.post("/yolo/stop")
def yolo_stop(): return yolo_manager.stop()

@router.get("/yolo/status")
def yolo_status(): return {"running": yolo_manager.is_running, "error": yolo_manager.error}

@router.get("/yolo/stream")
def yolo_stream():
    if not yolo_manager.is_running: raise HTTPException(409, "请先启动检测")
    return StreamingResponse(yolo_manager.frames(), media_type="multipart/x-mixed-replace; boundary=frame")
