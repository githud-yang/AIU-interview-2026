"""Status/SSE regressions with fake managers: no camera, Torch or model load."""
import asyncio
from datetime import datetime, timezone
import json
import unittest
from unittest.mock import Mock, patch

from src.web.services.yolo_stream import status_snapshot, yolo_events


class FakeRequest:
    def __init__(self):
        self.disconnected = False

    async def is_disconnected(self):
        return self.disconnected


def payload(frame):
    return json.loads(next(line[6:] for line in frame.splitlines() if line.startswith("data: ")))


class SnapshotTests(unittest.TestCase):
    def test_server_computes_elapsed_and_preserves_status_without_mutating_manager(self):
        raw = {"running": True, "state": "running", "started_at": "2026-10-10T00:00:00+00:00", "frame_count": 8}
        manager = Mock()
        manager.status.return_value = raw
        status = status_snapshot(manager, now=datetime(2026, 10, 10, 0, 2, 5, tzinfo=timezone.utc))
        self.assertEqual(status["elapsed_seconds"], 125)
        self.assertEqual(status["frame_count"], 8)
        self.assertNotIn("elapsed_seconds", raw)
        manager.start.assert_not_called()
        manager.stop.assert_not_called()

    def test_inactive_invalid_and_future_start_times_are_handled(self):
        manager = Mock()
        for started in [None, "bad-date", {}, float("inf")]:
            manager.status.return_value = {"running": True, "state": "starting", "started_at": started}
            self.assertIsNone(status_snapshot(manager)["elapsed_seconds"])
        manager.status.return_value = {"running": False, "state": "stopped", "started_at": 0}
        self.assertIsNone(status_snapshot(manager)["elapsed_seconds"])
        manager.status.return_value = {"running": True, "state": "running", "started_at": "2099-01-01T00:00:00Z"}
        self.assertEqual(status_snapshot(manager)["elapsed_seconds"], 0)


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_status_change_heartbeat_and_disconnect(self):
        request = FakeRequest()
        manager = Mock()
        stopped = {"running": False, "state": "stopped", "msg": "未启动\n下一行"}
        changed = {**stopped, "state": "error", "error": "模拟故障"}
        manager.status.side_effect = [stopped, stopped, changed]
        stream = yolo_events(manager, request, interval=0, heartbeat=0)
        first = await anext(stream)
        self.assertTrue(first.startswith("retry: 2000\nevent: status\n"))
        self.assertEqual(payload(first), {**stopped, "elapsed_seconds": None})
        self.assertEqual(first.count("data: "), 1, "Newlines in status text stay JSON escaped")
        self.assertEqual(await anext(stream), ": heartbeat\n\n", "Unchanged state does not emit another status")
        self.assertEqual(payload(await anext(stream))["state"], "error")
        request.disconnected = True
        with self.assertRaises(StopAsyncIteration):
            await anext(stream)
        self.assertEqual(manager.status.call_count, 3)
        manager.start.assert_not_called()
        manager.stop.assert_not_called()

    async def test_connection_closing_and_cancellation_do_not_stop_shared_detection(self):
        manager = Mock()
        manager.status.return_value = {"running": False, "state": "stopped"}
        stream = yolo_events(manager, FakeRequest(), interval=60)
        await anext(stream)
        waiting = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)
        waiting.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await waiting
        await stream.aclose()
        self.assertIsNone(stream.ag_frame)
        self.assertEqual(manager.status.call_count, 1)
        manager.stop.assert_not_called()

    async def test_disconnected_client_is_not_read_and_route_keeps_mjpeg(self):
        from src.web.routes import yolo_routes

        request = FakeRequest()
        request.disconnected = True
        manager = Mock()
        stream = yolo_events(manager, request)
        with self.assertRaises(StopAsyncIteration):
            await anext(stream)
        manager.status.assert_not_called()
        manager.status.return_value = {"running": False, "state": "stopped"}
        request.disconnected = False
        with patch.object(yolo_routes, "yolo_manager", manager):
            response = await yolo_routes.yolo_status_events(request)
            self.assertEqual(response.media_type, "text/event-stream")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["x-accel-buffering"], "no")
            self.assertEqual(payload(await anext(response.body_iterator))["elapsed_seconds"], None)
            await response.body_iterator.aclose()
            self.assertEqual(yolo_routes.yolo_status()["state"], "stopped")
        paths = {route.path for route in yolo_routes.router.routes}
        self.assertTrue({"/yolo/events", "/yolo/status", "/yolo/stream"}.issubset(paths))
        manager.stop.assert_not_called()


if __name__ == "__main__":
    unittest.main()
