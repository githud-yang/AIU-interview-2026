"""Conditionally release only the inference run a browser originally opened."""
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.web.managers.yolo_process_manager import YoloProcessManager
from src.web.routes.yolo_routes import router


class ConditionalStopTests(unittest.TestCase):
    def test_late_stop_preserves_a_replacement_run_and_its_frame(self):
        manager = YoloProcessManager()
        manager._started_at = "replacement"
        manager._state = "running"
        manager.frame = b"live frame"
        result = manager.stop(expected_started_at="previous")
        self.assertFalse(result["ok"])
        self.assertTrue(result["running"])
        self.assertEqual(manager.frame, b"live frame")
        self.assertFalse(manager._stop.is_set())
        self.assertTrue(manager.stop(expected_started_at="replacement")["ok"])
        self.assertIsNone(manager.frame)

    def test_stop_route_passes_the_precondition_and_retains_legacy_calls(self):
        app = FastAPI()
        app.include_router(router)
        manager = Mock()
        manager.status.return_value = {"running": False, "state": "stopped", "started_at": None}
        manager.stop.return_value = {"ok": True, **manager.status.return_value}
        with patch("src.web.routes.yolo_routes.yolo_manager", manager), TestClient(app) as client:
            self.assertEqual(client.post("/yolo/stop", json={"expected_started_at": "owned"}).status_code, 200)
            manager.stop.assert_called_once_with(expected_started_at="owned")
            manager.stop.reset_mock()
            self.assertEqual(client.post("/yolo/stop").status_code, 200)
            manager.stop.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
