"""提供模型与检测服务状态的只读 HTTP 接口。"""
from fastapi import APIRouter

from src.web.routes import chat_routes, yolo_routes

router = APIRouter()


@router.get("/api/health")
def health():
    return {
        "model": chat_routes.chat_service.agent.health(),
        "yolo": yolo_routes.yolo_manager.status(),
    }
