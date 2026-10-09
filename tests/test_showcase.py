"""检查展示台的公开文件边界和只读预检；不生成回复、启动实验或摄像头。"""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.web.routes import showcase_routes
from src.web.services import showcase_service as showcase


class ShowcaseTests(unittest.TestCase):
    def test_catalog_marks_missing_evidence_without_disclosing_private_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "docs").mkdir()
            (root / "docs/training_result.json").write_text('{}', encoding="utf-8")
            result = showcase.catalog(root)
        items = [item for card in result["cards"] for item in card["evidence"]]
        self.assertEqual([item["id"] for item in items if item["available"]], ["training"])
        self.assertTrue(all(item["id"] in showcase.FILES for item in items))
        self.assertNotIn("api_key", str(result).lower())

    def test_public_files_require_registered_ids_and_existing_regular_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for value in ["../configs/.env", "configs/.env", "yolo-camera", ".env", "training"]:
                self.assertIsNone(showcase.public_file(value, root))
            target = root / "docs/training_result.json"
            target.parent.mkdir()
            target.write_text('{}', encoding="utf-8")
            self.assertEqual(showcase.public_file("training", root), (target.resolve(), "application/json"))

    def test_registered_file_cannot_escape_through_linked_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            private = root / "private"
            private.mkdir()
            (private / "training_result.json").write_text('private', encoding="utf-8")
            link = root / "docs"
            if os.name == "nt":
                import _winapi
                _winapi.CreateJunction(str(private), str(link))
            else:
                link.symlink_to(private, target_is_directory=True)
            self.assertIsNone(showcase.public_file("training", root))

    def test_preflight_reads_local_health_without_running_work(self):
        agent = Mock(base_url="http://127.0.0.1:11434/v1", model="local")
        agent.health.return_value = {"available": True, "model": "local"}
        manager = Mock()
        manager.status.return_value = {"state": "stopped"}
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"YOLO_WEIGHTS": "weights.pt"}):
            root = Path(temporary)
            (root / "weights.pt").write_bytes(b"test weights")
            with patch.object(showcase.httpx, "get", return_value=Mock(json=lambda: {"ok": True})) as get:
                result = showcase.preflight(agent, manager, True, root=root)
        self.assertTrue(all(item["available"] for item in result["services"]))
        get.assert_called_once_with("http://127.0.0.1:4318/api/health", timeout=1.5, trust_env=False)
        agent.health.assert_called_once()
        agent.chat.assert_not_called()
        manager.status.assert_called_once()
        manager.start.assert_not_called()
        manager.stop.assert_not_called()

    def test_cloud_configuration_and_offline_services_degrade_without_cloud_request(self):
        agent = Mock(base_url="https://api.deepseek.com/v1", model="remote")
        manager = Mock(status=lambda: {"state": "stopped"})
        with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"YOLO_WEIGHTS": "absent.pt"}), patch.object(
            showcase.httpx, "get", side_effect=httpx.ConnectError("offline")
        ) as get:
            result = showcase.preflight(agent, manager, False, root=Path(temporary))
        self.assertTrue(all(not item["available"] for item in result["services"]))
        agent.health.assert_not_called()
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.args[0], "http://127.0.0.1:4318/api/health")

    def test_malformed_yinghuo_health_is_reported_as_unavailable(self):
        agent = Mock(base_url="http://localhost:11434/v1", health=lambda: {"available": False})
        manager = Mock(status=lambda: {"state": "stopped"})
        with patch.object(showcase.httpx, "get", return_value=Mock(json=lambda: [])):
            result = showcase.preflight(agent, manager, False)
        self.assertFalse(next(item for item in result["services"] if item["id"] == "yinghuo")["available"])

    def test_file_http_route_enforces_whitelist_and_nosniff(self):
        app = FastAPI()
        app.include_router(showcase_routes.router)
        original = showcase.public_file
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "docs").mkdir()
            (root / "docs/training_result.json").write_text('{"epochs":30}', encoding="utf-8")
            with patch.object(showcase, "public_file", side_effect=lambda file_id: original(file_id, root)):
                client = TestClient(app)
                response = client.get("/api/showcase/files/training")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"epochs": 30})
                self.assertEqual(response.headers["x-content-type-options"], "nosniff")
                self.assertEqual(client.get("/api/showcase/files/.env").status_code, 404)
                self.assertEqual(client.get("/api/showcase/files/yolo-camera").status_code, 404)


if __name__ == "__main__":
    unittest.main()
