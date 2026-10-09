"""提供面试展示入口与固定证据文件；状态计算委托展示服务。"""
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from src.web.routes import chat_routes, yolo_routes
from src.web.services import showcase_service, showcase_research

router = APIRouter()


@router.get("/showcase", include_in_schema=False)
def showcase_page():
    return FileResponse(showcase_service.ROOT / "src/web/static/showcase.html")


@router.get("/api/showcase")
def showcase_catalog():
    return showcase_service.catalog()


@router.get("/api/showcase/preflight")
def showcase_preflight(request: Request):
    return showcase_service.preflight(chat_routes.chat_service.agent, yolo_routes.yolo_manager,
                                     getattr(request.app.state, "research", None) is not None)


@router.get("/api/showcase/files/{file_id}")
def showcase_file(file_id: str):
    item = showcase_service.public_file(file_id)
    if item is None:
        raise HTTPException(404, "展示资料不存在；只支持已登记的公开资料")
    path, media_type = item
    return FileResponse(path, media_type=media_type, filename=path.name, content_disposition_type="inline",
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"})


@router.get("/api/showcase/research")
def stage_research(request: Request):
    return showcase_research.stage_research(getattr(request.app.state, "research", None))


@router.get("/api/showcase/research/files/{file_id}")
def stage_research_file(file_id: str, request: Request):
    item = showcase_research.stage_artifact(getattr(request.app.state, "research", None), file_id)
    if item is None:
        raise HTTPException(404, "示例产物不存在或原始哈希核验未通过")
    path, media_type = item
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"}
    if media_type == "text/html":
        headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
    return FileResponse(path, media_type=media_type, filename=path.name,
                        content_disposition_type="inline", headers=headers)
