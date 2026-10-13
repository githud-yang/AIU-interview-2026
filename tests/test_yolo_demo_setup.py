"""Pinned demo installation rejects corrupt downloads and preserves good data."""
import hashlib
import io
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts import setup_yolo_demo as setup


class DemoSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.target = Path(self.temporary.name) / "examples" / "vtest.avi"
        self.payload = b"small verified video fixture"
        self.patches = [patch.object(setup, "DEMO_BYTES", len(self.payload)),
                        patch.object(setup, "DEMO_SHA256", hashlib.sha256(self.payload).hexdigest())]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.temporary.cleanup()

    def test_verified_existing_file_needs_no_network(self):
        self.target.parent.mkdir()
        self.target.write_bytes(self.payload)
        with patch.object(setup, "urlopen") as network:
            self.assertEqual(setup.install_demo(self.target), self.target)
        network.assert_not_called()

    def test_download_is_checked_before_atomic_replacement(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"previous file")
        with patch.object(setup, "urlopen", return_value=io.BytesIO(self.payload)):
            self.assertEqual(setup.install_demo(self.target), self.target)
        self.assertEqual(self.target.read_bytes(), self.payload)
        self.assertEqual(list(self.target.parent.glob("*.part")), [])

    def test_corrupt_truncated_and_oversized_downloads_keep_original(self):
        self.target.parent.mkdir()
        self.target.write_bytes(b"previous file")
        bad_payloads = [b"x" * len(self.payload), self.payload[:-1], self.payload + b"x"]
        for payload in bad_payloads:
            with self.subTest(length=len(payload)), patch.object(setup, "urlopen", return_value=io.BytesIO(payload)):
                with self.assertRaises(ValueError):
                    setup.install_demo(self.target)
                self.assertEqual(self.target.read_bytes(), b"previous file")
                self.assertEqual(list(self.target.parent.glob("*.part")), [])


if __name__ == "__main__":
    unittest.main()
