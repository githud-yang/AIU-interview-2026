"""检查固定已完成研究的摘要、原始哈希和同页报告预览边界。"""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.web.routes.showcase_routes import router
from src.web.services.showcase_research import RUN_ID, stage_artifact, stage_research


def completed_run():
    return {"status": "completed", "budget": {"elapsed_seconds": 202},
            "stages": [{"id": "experiments", "label": "实验", "status": "completed"}],
            "outputs": {"experiment": {"evaluation_jobs_completed": 5, "training_fits": 0,
                                        "summary": [{"imgsz": 480, "split": "evaluation", "latency_ms": 12.9, "map50_95": .47}]}},
            "artifacts": [{"id": "v3", "path": "manuscript_v3/paper.html"},
                          {"id": "private", "path": "writer/private-config.json"}],
            "api_key": "private-test-marker"}


class StageResearchTests(unittest.TestCase):
    def test_completed_snapshot_selects_public_facts_without_mutating_or_exposing_private_fields(self):
        current = Mock()
        current.store.get.return_value = completed_run()
        current.store.artifact_path.return_value = Path("paper.html")
        result = stage_research(current)
        self.assertTrue(result["available"])
        self.assertEqual(result["source"], "本机已完成运行")
        self.assertEqual(result["metrics"][2]["value"], "5")
        self.assertEqual(result["comparison"][0]["imgsz"], 480)
        self.assertNotIn("private-test-marker", json.dumps(result))
        self.assertNotIn("private-config", json.dumps(result))
        current.create.assert_not_called()
        current.resume.assert_not_called()

    def test_missing_runtime_uses_archive_and_disables_unavailable_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "evidence").mkdir()
            (root / "evidence/research-yolo-runtime-smoke.json").write_text(json.dumps({"run": completed_run()}), encoding="utf-8")
            result = stage_research(root=root)
            self.assertEqual(result["source"], "已归档运行快照")
            self.assertTrue(result["available"])
            self.assertTrue(all(not item["available"] for item in result["artifacts"]))
        with tempfile.TemporaryDirectory() as empty:
            self.assertFalse(stage_research(root=Path(empty))["available"])

    def test_only_fixed_registered_completed_artifact_can_be_previewed(self):
        current = Mock()
        current.store.get.return_value = completed_run()
        current.store.artifact_path.return_value = Path("report.html")
        self.assertIsNone(stage_artifact(current, "../.env"))
        self.assertIsNone(stage_artifact(current, "private"))
        current.store.get.assert_not_called()
        self.assertEqual(stage_artifact(current, "report"), (Path("report.html"), "text/html"))
        current.store.artifact_path.assert_called_once_with(RUN_ID, "v3")
        current.store.artifact_path.side_effect = ValueError("hash changed")
        self.assertIsNone(stage_artifact(current, "report"))
        current.store.get.return_value = {**completed_run(), "status": "running"}
        current.store.artifact_path.reset_mock()
        self.assertIsNone(stage_artifact(current, "report"))
        current.store.artifact_path.assert_not_called()

    def test_report_http_is_inline_with_script_blocking_sandbox_and_missing_file_is_404(self):
        app = FastAPI()
        app.include_router(router)
        current = Mock()
        current.store.get.return_value = completed_run()
        app.state.research = current
        with tempfile.TemporaryDirectory() as temporary:
            report = Path(temporary) / "paper.html"
            report.write_text("<h1>saved result</h1><script>alert('x')</script>", encoding="utf-8")
            current.store.artifact_path.return_value = report
            client = TestClient(app)
            response = client.get("/api/showcase/research/files/report")
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.headers["content-disposition"].startswith("inline"))
            self.assertIn("sandbox;", response.headers["content-security-policy"])
            self.assertIn("default-src 'none'", response.headers["content-security-policy"])
            self.assertNotIn("allow-scripts", response.headers["content-security-policy"])
            self.assertEqual(response.headers["x-content-type-options"], "nosniff")
            self.assertEqual(client.get("/api/showcase/research/files/private").status_code, 404)


if __name__ == "__main__":
    unittest.main()
