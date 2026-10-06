import httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from src.web.services.chat_service import AdventureChatService
router = APIRouter()
chat_service = AdventureChatService()
class Turn(BaseModel):
    user: str = Field(max_length=4000)
    ai: str = Field(max_length=12000)
class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    history: list[Turn] = Field(default_factory=list, max_length=10)

@router.get("/", response_class=HTMLResponse)
def index(request: Request):
    return request.app.state.templates.TemplateResponse(request=request, name="index.html")

@router.post("/api/chat")
def api_chat(body: ChatRequest):
    if not body.message.strip(): raise HTTPException(422, "消息不能为空")
    try:
        return {"reply": chat_service.chat(body.message, [turn.model_dump() for turn in body.history])}
    except httpx.HTTPError:
        raise HTTPException(503, "模型服务不可用，请确认 Ollama 已启动且模型已下载")
