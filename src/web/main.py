"""组装 Web 应用、静态资源和路由；计算与生命周期交给功能模块。"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.web.routes import chat_routes, health_routes, research_routes, yolo_routes
from src.web.services.lifecycle import create_lifespan

# 路径常量
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parents[1]


def create_app(*, research_root: Path | None = None) -> FastAPI:
    """保留可注入的数据目录，便于隔离测试和多份演示环境。"""
    lifespan = create_lifespan(
        research_root=research_root or PROJECT_ROOT / "logs" / "research",
        settings_path=PROJECT_ROOT / "configs" / ".env",
        yolo_manager=yolo_routes.yolo_manager,
    )
    app = FastAPI(lifespan=lifespan, title="AIU 创智部二面 · 综合演示")

    # 挂载静态文件和模板
    static_dir = BASE_DIR / "static"
    templates_dir = BASE_DIR / "static"
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    app.state.templates = Jinja2Templates(directory=templates_dir)

    # 注册路由模块
    app.include_router(chat_routes.router)
    app.include_router(yolo_routes.router)
    app.include_router(research_routes.router)
    app.include_router(health_routes.router)

    return app


# 全局app实例，uvicorn加载入口
app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
