"""Research workspace API. Artifact paths are never accepted from clients."""
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import ValidationError

from src.research.contracts import RunRequest, ResumeRequest, STAGES
from src.research.settings import DeepSeekRequest

router = APIRouter()
STATIC = Path(__file__).resolve().parents[1] / "static"
SETTINGS_REQUEST_SCHEMA = {"requestBody": {"required": True, "content": {
    "application/json": {"schema": DeepSeekRequest.model_json_schema()}}}}


def service(request):
    current = getattr(request.app.state, "research", None)
    if current is None:
        raise HTTPException(503, "科研依赖未就绪，请使用 .venv 并安装 requirements-research.txt")
    return current


def translate_error(exc):
    if isinstance(exc, KeyError):
        return HTTPException(404, "研究或产物不存在")
    return HTTPException(409, str(exc))


@router.get("/research", include_in_schema=False)
def research_page():
    return FileResponse(STATIC / "research.html")


@router.get("/api/research/capabilities")
async def capabilities(request: Request):
    current = getattr(request.app.state, "research", None)
    if current is None:
        return {"model": {"available": False, "error": "科研依赖尚未安装"},
                "execution": {"available": False, "mode": "unavailable", "detail": "安装 requirements-research.txt 并重启"},
                "domains": [], "stages": [{"id": k, "label": v} for k, v in STAGES],
                "limitations": ["当前环境缺少科研依赖"]}
    return await current.capabilities()


@router.post("/api/research/runs", status_code=202)
async def create_run(body: RunRequest, request: Request):
    try:
        return service(request).create(body)
    except ValueError as exc:
        raise translate_error(exc) from exc


@router.get("/api/research/runs")
def runs(request: Request):
    return {"runs": service(request).store.list_runs()}


@router.get("/api/research/runs/{run_id}")
def run(run_id: str, request: Request):
    try:
        return service(request).store.get(run_id)
    except KeyError as exc:
        raise translate_error(exc) from exc


@router.get("/api/research/runs/{run_id}/events")
def events(run_id: str, request: Request, after_seq: int = Query(0, ge=0)):
    try:
        return service(request).store.events(run_id, after_seq)
    except KeyError as exc:
        raise translate_error(exc) from exc


@router.post("/api/research/runs/{run_id}/cancel")
async def cancel(run_id: str, request: Request):
    try:
        return service(request).cancel(run_id)
    except KeyError as exc:
        raise translate_error(exc) from exc


@router.post("/api/research/runs/{run_id}/resume")
async def resume(run_id: str, request: Request, body: ResumeRequest | None = None):
    try:
        return await service(request).resume(run_id, automatic=bool(body and body.initiator == "agent"))
    except (KeyError, ValueError) as exc:
        raise translate_error(exc) from exc


@router.get("/api/research/runs/{run_id}/artifacts/{artifact_id}")
def artifact(run_id: str, artifact_id: str, request: Request):
    try:
        path = service(request).store.artifact_path(run_id, artifact_id)
        return FileResponse(path, filename=path.name)
    except (KeyError, ValueError) as exc:
        raise translate_error(exc) from exc


@router.post("/api/research/runs/{run_id}/export")
async def export(run_id: str, request: Request):
    try:
        return await service(request).export(run_id)
    except (KeyError, ValueError) as exc:
        raise translate_error(exc) from exc


def settings_service(request):
    current = service(request)
    settings = getattr(current, "writer_settings", None)
    if settings is None:
        raise HTTPException(503, "论文模型设置尚未初始化，请重启服务")
    return settings


async def settings_body(request):
    """Validate credential-bearing requests without FastAPI echoing raw inputs."""
    from src.research.settings import DeepSeekRequest
    if request.url.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "论文模型设置仅允许本机工作台访问")
    origin = request.headers.get("origin")
    if origin:
        try:
            parsed = urlsplit(origin)
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        except ValueError:
            raise HTTPException(403, "已拒绝无效的页面来源") from None
        request_port = request.url.port or (443 if request.url.scheme == "https" else 80)
        if parsed.scheme != request.url.scheme or parsed.hostname != request.url.hostname or port != request_port or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise HTTPException(403, "请在当前工作台页面保存论文模型设置")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "已拒绝跨站配置请求")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(415, "论文模型设置需要 JSON 请求")
    try:
        raw = await request.body()
        if len(raw) > 8192:
            raise ValueError("Oversized settings")
        return DeepSeekRequest.model_validate_json(raw)
    except (ValidationError, ValueError, TypeError):
        raise HTTPException(400, "请输入有效的 API key 和模型名称，且不要添加其他配置字段") from None


@router.get("/api/research/writer-settings")
def writer_settings(request: Request):
    return JSONResponse(settings_service(request).status(), headers={"Cache-Control": "no-store"})


@router.post("/api/research/writer-settings/test", openapi_extra=SETTINGS_REQUEST_SCHEMA)
async def test_writer_settings(request: Request):
    from src.research.settings import SettingsError
    body = await settings_body(request)
    try:
        return JSONResponse(await settings_service(request).test(body), headers={"Cache-Control": "no-store"})
    except SettingsError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None


@router.put("/api/research/writer-settings", openapi_extra=SETTINGS_REQUEST_SCHEMA)
async def save_writer_settings(request: Request):
    from src.research.settings import SettingsError
    body = await settings_body(request)
    try:
        return JSONResponse(await settings_service(request).save(body), headers={"Cache-Control": "no-store"})
    except SettingsError as exc:
        raise HTTPException(exc.status_code, str(exc)) from None
