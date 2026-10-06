"""
Web应用主入口
==============
只负责组装所有模块、初始化全局对象，不包含任何业务逻辑。
启动命令：uvicorn src.web.main:app --port 8000
"""
from __future__ import annotations

from contextlib import asynccontextmanager
import threading
import webbrowser
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.web.routes import chat_routes, yolo_routes

# 路径常量
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parents[2]


def create_app() -> FastAPI:
    """应用工厂函数，创建并配置FastAPI实例"""
    @asynccontextmanager
    async def lifespan(app):
        yield
        yolo_routes.yolo_manager.stop()

    app = FastAPI(lifespan=lifespan, title="AIU 创智部二面 · 综合演示")

    # 挂载静态文件和模板
    static_dir = BASE_DIR / "static"
    templates_dir = BASE_DIR / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    app.state.templates = Jinja2Templates(directory=templates_dir)

    # 注册路由模块
    app.include_router(chat_routes.router)
    app.include_router(yolo_routes.router)

    return app


# 全局app实例，uvicorn加载入口
app = create_app()


if __name__ == "__main__":
    import uvicorn

    # 启动2秒后自动打开浏览器
    threading.Timer(2.0, lambda: webbrowser.open("http://127.0.0.1:8000")).start()
    uvicorn.run(app, host="127.0.0.1", port=8000)
