"""验证 Web 组装拆分后的启动降级、健康接口与退出资源清理。"""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi.testclient import TestClient

from src.web.main import create_app


class WebLifecycleTests(unittest.TestCase):
    def test_factory_defers_service_creation_and_wires_start_shutdown(self):
        service = Mock(start=AsyncMock(), shutdown=AsyncMock())
        with tempfile.TemporaryDirectory() as temporary, patch(
            "src.web.services.lifecycle.create_research_service", return_value=service
        ) as create_service, patch("src.web.routes.yolo_routes.yolo_manager.stop") as stop:
            root = Path(temporary)
            app = create_app(research_root=root)
            create_service.assert_not_called()
            with TestClient(app):
                self.assertIs(app.state.research, service)
                self.assertEqual(create_service.call_args.args[0], root)
                service.start.assert_awaited_once()
            service.shutdown.assert_awaited_once()
            stop.assert_called_once()

    def test_missing_research_dependencies_keeps_basic_pages_available(self):
        with patch(
            "src.web.services.lifecycle.create_research_service",
            side_effect=ImportError("optional research dependency is missing"),
        ), patch("src.web.routes.yolo_routes.yolo_manager.stop") as stop:
            with TestClient(create_app()) as client:
                self.assertEqual(client.get("/").status_code, 200)
                self.assertEqual(client.get("/yolo").status_code, 200)
                response = client.get("/api/research/capabilities")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["execution"]["available"])
                self.assertIsNone(client.app.state.research)
                self.assertIn("optional research", client.app.state.research_error)
            stop.assert_called_once()

    def test_health_route_keeps_existing_response_contract(self):
        with patch("src.web.routes.chat_routes.chat_service.agent.health", return_value={"available": True}), patch(
            "src.web.routes.yolo_routes.yolo_manager.status", return_value={"state": "stopped"}
        ):
            response = TestClient(create_app()).get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"model": {"available": True}, "yolo": {"state": "stopped"}})

    def test_yolo_cleanup_still_runs_when_research_shutdown_fails(self):
        service = Mock(start=AsyncMock(), shutdown=AsyncMock(side_effect=RuntimeError("shutdown failed")))
        with patch("src.web.services.lifecycle.create_research_service", return_value=service), patch(
            "src.web.routes.yolo_routes.yolo_manager.stop"
        ) as stop:
            with self.assertRaisesRegex(RuntimeError, "shutdown failed"):
                with TestClient(create_app()):
                    pass
            service.shutdown.assert_awaited_once()
            stop.assert_called_once()


if __name__ == "__main__":
    unittest.main()
