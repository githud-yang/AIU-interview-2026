"""Artifact previews preserve the store's hash/path checks and never run research."""
import base64
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.research.contracts import RunRequest
from src.research.store import ResearchStore
from src.web.routes.research_routes import router


class ResearchArtifactPreviewTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.store = ResearchStore(Path(self.temporary.name))
        self.addCleanup(self.store.close)
        fixture, _ = self.store.create(RunRequest(
            goal="Read existing results without executing an experiment", request_id="preview-fixture"))
        self.run_id = fixture["id"]
        self.store.update(self.run_id, {"status": "completed"})
        self.service = SimpleNamespace(store=self.store, create=Mock(), resume=Mock(), export=Mock())
        app = FastAPI()
        app.state.research = self.service
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def tearDown(self):
        self.service.create.assert_not_called()
        self.service.resume.assert_not_called()
        self.service.export.assert_not_called()
        self.assertEqual(len(self.store.list_runs()), 1)
        self.assertEqual(self.store.get(self.run_id)["status"], "completed")
        self.assertEqual(len(self.store.events(self.run_id)["events"]), 1)

    def artifact(self, name, content):
        path = self.store.run_dir(self.run_id) / name
        path.write_bytes(content)
        record = self.store.artifact(self.run_id, path)
        self.store.update(self.run_id, mutate=lambda run: run["artifacts"].append(record))
        return path, record

    def get(self, record, preview=True):
        return self.client.get(record["url"], params={"preview": 1} if preview else None)

    def assert_response_headers(self, response, disposition):
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["cache-control"], "no-cache")
        self.assertTrue(response.headers["content-disposition"].startswith(disposition + ";"))

    def test_html_preview_is_inline_and_sandboxed(self):
        content = "<h1>实验论文</h1><style>h1{color:blue}</style><script>alert(1)</script>".encode()
        _, record = self.artifact("paper.zh.html", content)
        response = self.get(record)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, content)
        self.assertEqual(response.headers["content-type"], "text/html; charset=utf-8")
        self.assert_response_headers(response, "inline")
        csp = response.headers["content-security-policy"]
        self.assertEqual(csp, "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'")
        self.assertNotIn("allow-scripts", csp)
        self.assertNotIn("allow-same-origin", csp)

    def test_png_preview_is_inline_with_image_media_type(self):
        content = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7S8AAAAASUVORK5CYII=")
        _, record = self.artifact("results.png", content)
        response = self.get(record)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, content)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assert_response_headers(response, "inline")

    def test_default_download_remains_attachment_for_all_formats(self):
        for name in ("paper.html", "results.png", "results.csv", "materials.zip"):
            with self.subTest(name=name):
                _, record = self.artifact(name, b"fixture output")
                response = self.get(record, preview=False)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, b"fixture output")
                self.assert_response_headers(response, "attachment")

    def test_preview_rejects_formats_outside_html_and_png(self):
        for name in ("paper.md", "paper.pdf", "figure.svg", "figure.jpg", "results.csv", "script.js"):
            with self.subTest(name=name):
                _, record = self.artifact(name, b"not permitted for inline preview")
                response = self.get(record)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("not permitted for inline preview", response.text)

    def test_missing_run_record_or_file_stays_not_found(self):
        path, record = self.artifact("paper.html", b"saved report")
        path.unlink()
        urls = (record["url"], f"/api/research/runs/{self.run_id}/artifacts/missing",
                f"/api/research/runs/missing/artifacts/{record['id']}")
        for url in urls:
            for preview in (0, 1):
                with self.subTest(url=url, preview=preview):
                    self.assertEqual(self.client.get(url, params={"preview": preview}).status_code, 404)

    def test_changed_hash_is_rejected_for_preview_and_download(self):
        for name in ("paper.html", "results.png"):
            path, record = self.artifact(name, b"registered bytes")
            path.write_bytes(b"changed content must not be returned")
            for preview in (False, True):
                with self.subTest(name=name, preview=preview):
                    response = self.get(record, preview=preview)
                    self.assertEqual(response.status_code, 409)
                    self.assertIn("哈希变化", response.json()["detail"])
                    self.assertNotIn("changed content", response.text)

    def test_preview_cannot_escape_the_registered_run_directory(self):
        _, record = self.artifact("paper.html", b"registered report")
        outside = self.store.root / "outside.html"
        outside.write_bytes(b"outside private marker")
        self.store.update(self.run_id, mutate=lambda run: run["artifacts"][0].update(path="../../outside.html"))
        response = self.get(record)
        self.assertEqual(response.status_code, 404)
        self.assertNotIn("outside private marker", response.text)


if __name__ == "__main__":
    unittest.main()
