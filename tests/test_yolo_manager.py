"""Lifecycle regressions without opening a physical camera or loading Torch."""
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import types
import unittest
from unittest.mock import Mock, patch

from src.web.managers.yolo_process_manager import YoloProcessManager
from src.yolo.sources import FrameSource, SourceSpec, resolve_source


class FakeFrame:
    def __init__(self, brightness=100):
        self.brightness = brightness

    def mean(self):
        return self.brightness


class FakeSource:
    def __init__(self, brightness=100, fail=False):
        self.closed = False
        self.brightness = brightness
        self.fail = fail

    def read(self):
        if self.fail:
            raise RuntimeError("read failed")
        return FakeFrame(self.brightness)

    def close(self):
        self.closed = True


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.weights = Path(self.tmp.name) / "best.pt"
        self.weights.write_bytes(b"test-only")
        self.manager = YoloProcessManager(join_timeout=0.02)
        self.spec = SourceSpec("demo", "public fake image", "image", "not-used", frame_interval=0.01)
        self.env = patch.dict("os.environ", {"YOLO_WEIGHTS": str(self.weights), "YOLO_CONF": "0.25"})
        self.env.start()
        self.resolver = patch("src.web.managers.yolo_process_manager.resolve_source", return_value=self.spec)
        self.resolver.start()
        encoded = Mock()
        encoded.tobytes.return_value = b"jpeg"
        self.cv2 = types.SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=Mock(return_value=(True, encoded)))
        self.modules = patch.dict("sys.modules", {"cv2": self.cv2})
        self.modules.start()
        self.source = FakeSource()
        self.manager._open_source = Mock(return_value=self.source)
        self.manager._load_model = Mock(return_value=Mock(return_value=[types.SimpleNamespace(plot=lambda: FakeFrame())]))

    def tearDown(self):
        self.manager._join_timeout = 1
        self.manager.stop()
        self.modules.stop()
        self.resolver.stop()
        self.env.stop()
        self.tmp.cleanup()

    def wait(self, predicate):
        with self.manager._condition:
            self.assertTrue(self.manager._condition.wait_for(predicate, timeout=2), self.manager.status())

    def test_shared_clients_double_start_and_stop_release(self):
        self.assertTrue(self.manager.start("demo")["ok"])
        self.wait(lambda: self.manager._frame_count > 0)
        first, second = self.manager.frames(), self.manager.frames()
        self.assertIn(b"jpeg", next(first))
        self.assertIn(b"jpeg", next(second))
        self.assertTrue(self.manager.start("demo")["ok"])
        self.assertEqual(self.manager._open_source.call_count, 1)
        self.assertFalse(self.manager.start("camera")["ok"])
        self.assertTrue(self.manager.stop()["ok"])
        self.assertTrue(self.source.closed)
        self.assertFalse(self.manager.status()["running"])
        self.assertIsNone(self.manager.frame)
        with self.assertRaises(StopIteration):
            next(first)
        with self.assertRaises(StopIteration):
            next(second)

    def test_read_failure_releases_and_restart_is_possible(self):
        self.source.fail = True
        self.manager.start("demo")
        self.wait(lambda: self.manager._state == "error")
        self.manager._thread.join(1)
        self.assertTrue(self.source.closed)
        self.assertIn("read failed", self.manager.status()["error"])
        self.source = FakeSource()
        self.manager._open_source.return_value = self.source
        self.assertTrue(self.manager.start("demo")["ok"])
        self.wait(lambda: self.manager._frame_count > 0)
        self.assertEqual(self.manager.status()["error"], "")

    def test_model_load_failure_does_not_open_source(self):
        self.manager._load_model.side_effect = RuntimeError("bad weights")
        self.manager.start("demo")
        self.wait(lambda: self.manager._state == "error")
        self.manager._thread.join(1)
        self.manager._open_source.assert_not_called()
        self.assertIn("bad weights", self.manager.status()["error"])

    def test_missing_weights_is_immediate_and_does_not_spawn(self):
        self.weights.unlink()
        self.assertFalse(self.manager.start("demo")["ok"])
        self.assertEqual(self.manager.status()["state"], "error")
        self.assertIsNone(self.manager._thread)

    def test_black_frame_is_warning_and_still_streams(self):
        self.source.brightness = 0
        self.manager.start("demo")
        self.wait(lambda: self.manager._frame_count > 0)
        self.assertTrue(self.manager.status()["running"])
        self.assertEqual(self.manager.status()["error"], "")
        self.assertIn("全黑", self.manager.status()["warning"])

    def test_encode_failure_releases_source(self):
        self.cv2.imencode.return_value = (False, None)
        self.manager.start("demo")
        self.wait(lambda: self.manager._state == "error")
        self.manager._thread.join(1)
        self.assertTrue(self.source.closed)
        self.assertIn("编码失败", self.manager.status()["error"])

    def test_stop_timeout_reports_stopping_and_prevents_restart(self):
        entered, resume = threading.Event(), threading.Event()
        def blocking_load(weights):
            entered.set()
            resume.wait(2)
            return Mock()
        self.manager._load_model = blocking_load
        self.manager.start("demo")
        self.assertTrue(entered.wait(1))
        try:
            stopped = self.manager.stop()
            self.assertFalse(stopped["ok"])
            self.assertEqual(stopped["state"], "stopping")
            self.assertFalse(self.manager.start("demo")["ok"])
        finally:
            resume.set()
            self.manager._thread.join(1)
        self.assertEqual(self.manager.status()["state"], "stopped")
        self.manager._open_source.assert_not_called()

    def test_video_completion_keeps_final_frame_and_ends_stream(self):
        self.manager._open_source.return_value = types.SimpleNamespace(read=Mock(side_effect=[FakeFrame(), None]), close=Mock())
        self.manager.start("demo")
        self.wait(lambda: self.manager._state == "finished")
        self.manager._thread.join(1)
        stream = self.manager.frames()
        self.assertIn(b"jpeg", next(stream))
        with self.assertRaises(StopIteration):
            next(stream)


class SourceTests(unittest.TestCase):
    def test_arbitrary_http_or_local_path_is_not_accepted_by_web(self):
        for value in ["https://example.test/video", "C:/secret.mp4", "-1"]:
            with self.assertRaises(ValueError):
                resolve_source(value, Path.cwd())

    def test_invalid_camera_and_missing_server_video_are_explained(self):
        with patch.dict("os.environ", {"YOLO_CAMERA": "-2", "YOLO_VIDEO": ""}):
            with self.assertRaises(ValueError):
                resolve_source("camera", Path.cwd())
            with self.assertRaises(ValueError):
                resolve_source("video", Path.cwd())

    def test_failed_camera_setup_releases_capture(self):
        capture = Mock()
        capture.isOpened.return_value = True
        capture.set.side_effect = RuntimeError("driver error")
        cv2 = types.SimpleNamespace(VideoCapture=Mock(return_value=capture), CAP_PROP_BUFFERSIZE=1)
        with patch.dict("sys.modules", {"cv2": cv2}):
            with self.assertRaisesRegex(RuntimeError, "driver error"):
                FrameSource(SourceSpec("camera", "camera", "camera", 0))
        capture.release.assert_called_once()


if __name__ == "__main__":
    unittest.main()
