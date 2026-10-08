"""Opt-in real HTTP/public-image/video smoke test: YOLO_RUNTIME_TEST=1."""
from contextlib import ExitStack
import json
import os
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest.mock import patch


@unittest.skipUnless(os.getenv("YOLO_RUNTIME_TEST") == "1", "opt-in real inference; no physical camera is opened")
class YoloRuntimeTests(unittest.TestCase):
    def test_public_sample_two_http_streams_and_local_video(self):
        import cv2
        from fastapi import FastAPI
        import httpx
        import uvicorn
        from src.web.routes import yolo_routes
        from src.yolo.sources import FrameSource, resolve_source

        app = FastAPI()
        app.include_router(yolo_routes.router)
        manager = yolo_routes.yolo_manager
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 8011))
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=8011, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        report = {"source": "installed ultralytics/assets/bus.jpg", "network": "127.0.0.1 only", "physical_camera_opened": False}

        def wait(predicate, timeout=60):
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if predicate():
                    return
                time.sleep(0.05)
            self.fail(f"timeout; status={manager.status()}")

        try:
            wait(lambda: server.started, timeout=10)
            with patch.dict("os.environ", {"YOLO_SOURCE": "demo"}), httpx.Client(base_url="http://127.0.0.1:8011", timeout=30) as client:
                self.assertEqual(client.get("/yolo/stream").status_code, 409)
                self.assertEqual(client.post("/yolo/start", json={"source": "C:/secret.mp4"}).status_code, 422)
                self.assertTrue(client.post("/yolo/start").json()["ok"])
                wait(lambda: manager.status()["frame_count"] >= 1)
                status = client.get("/yolo/status").json()
                self.assertEqual(status["source"], "demo")
                self.assertEqual(status["state"], "running")
                stream_bytes = []
                with ExitStack() as stack:
                    responses = [stack.enter_context(client.stream("GET", "/yolo/stream")) for _ in range(2)]
                    iterators = [response.iter_bytes() for response in responses]
                    for response, iterator in zip(responses, iterators):
                        self.assertEqual(response.status_code, 200)
                        self.assertIn("multipart/x-mixed-replace", response.headers["content-type"])
                        content = b""
                        while b"\xff\xd9" not in content:
                            content += next(iterator)
                        self.assertTrue(content.startswith(b"--frame\r\n"))
                        self.assertIn(b"\xff\xd8", content)
                        stream_bytes.append(len(content))
                    self.assertTrue(client.post("/yolo/stop").json()["ok"])
                    for iterator in iterators:
                        list(iterator)  # The server ends both clients when inference stops.
                self.assertEqual(client.get("/yolo/status").json()["state"], "stopped")
                report["public_image"] = {"status": status, "clients": 2, "jpeg_bytes_per_client": stream_bytes, "stream_ended_after_stop": True}

                source = FrameSource(resolve_source("demo", Path.cwd()))
                try:
                    image = source.read()
                finally:
                    source.close()
                with TemporaryDirectory() as temporary:
                    video = Path(temporary) / "public_sample.avi"
                    writer = cv2.VideoWriter(str(video), cv2.VideoWriter_fourcc(*"MJPG"), 5.0, (320, 240))
                    self.assertTrue(writer.isOpened(), "local MJPG encoder unavailable")
                    try:
                        for _ in range(3):
                            writer.write(cv2.resize(image, (320, 240)))
                    finally:
                        writer.release()
                    with patch.dict("os.environ", {"YOLO_VIDEO": str(video), "YOLO_VIDEO_LOOP": "0"}):
                        self.assertTrue(client.post("/yolo/start", json={"source": "video"}).json()["ok"])
                        wait(lambda: manager.status()["state"] in {"finished", "error"})
                        video_status = client.get("/yolo/status").json()
                        self.assertEqual(video_status["state"], "finished", video_status)
                        self.assertEqual(video_status["frame_count"], 3)
                        self.assertEqual(video_status["error"], "")
                        manager._thread.join(timeout=5)
                        self.assertFalse(manager._thread.is_alive())
                        self.assertEqual(manager.status()["state"], "finished")
                        report["local_video"] = {"frame_count": 3, "state": "finished", "source": "3-frame AVI generated from public bus.jpg, no camera", "capture_released": not manager._thread.is_alive()}
                        self.assertTrue(client.post("/yolo/stop").json()["ok"])
            if os.getenv("YOLO_RUNTIME_REPORT"):
                target = Path(os.environ["YOLO_RUNTIME_REPORT"])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        finally:
            manager.stop()
            server.should_exit = True
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "temporary verification server failed to exit")


if __name__ == "__main__":
    unittest.main()
