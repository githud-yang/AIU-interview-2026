"""
聊天相关路由
============
只负责HTTP请求解析和响应返回，业务逻辑全部委托给服务层。
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from src.web.services.chat_service import AdventureChatService

router = APIRouter()
chat_service = AdventureChatService()


@router.get("/", response_class=HTMLResponse)
async def index(request: Request):
    """首页：返回文字冒险游戏页面"""
    templates = request.app.state.templates
    return templates.TemplateResponse(request, "index.html")


@router.post("/api/chat")
async def api_chat(request: Request):
    """聊天接口：接收用户消息和历史，返回AI回复"""
    body = await request.json()
    user_text = body.get("message", "")
    history = body.get("history", [])

    reply = chat_service.chat(user_text, history)
    return {"reply": reply}
