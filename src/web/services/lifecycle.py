"""管理科研服务启动与资源释放；缺少可选科研依赖时保留基础 Web 功能。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI


def create_research_service(root: Path, settings_path: Path):
    """延迟加载可选依赖，不在应用导入时创建数据库或启动任务。"""
    from src.research.runtime import ResearchService
    from src.research.settings import DeepSeekSettings

    service = ResearchService(root)
    service.writer_settings = DeepSeekSettings(settings_path, service)
    return service


def create_lifespan(*, research_root: Path, settings_path: Path, yolo_manager):
    """绑定应用实例的服务目录和检测资源，不启动浏览器或独立进程。"""
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.research = None
        app.state.research_error = ""
        try:
            try:
                service = create_research_service(research_root, settings_path)
            except ImportError as exc:
                app.state.research_error = str(exc)
            else:
                app.state.research = service
                await service.start()
            yield
        finally:
            try:
                if app.state.research is not None:
                    await app.state.research.shutdown()
            finally:
                yolo_manager.stop()

    return lifespan
