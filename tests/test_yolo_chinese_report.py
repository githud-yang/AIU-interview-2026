"""中文导出保留负结果、拒绝损坏证据，并只向历史账本追加版本。"""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from src.research.contracts import RunRequest
from src.research.domain import artifact
from src.research.store import ResearchStore
from src.research.yolo_chinese_report import _sections, build_yolo_chinese_report, export_yolo_chinese_reading


class ChineseReportTests(unittest.TestCase):
    def test_discussion_preserves_slower_selected_configuration_and_percentage_units(self):
        verified = {"summary": [
            {"split": "evaluation", "imgsz": 480, "map50_95": .47, "latency_ms": 13},
            {"split": "evaluation", "imgsz": 640, "map50_95": .48, "latency_ms": 12}],
            "selected_imgsz": 480, "protocol": {"counts": {"selection": 59, "evaluation": 59}},
            "environment": {"device": "test-device", "precision": "FP32"}}
        sections, _ = _sections(verified, [])
        results = dict(sections)["6. 实测结果"]
        self.assertIn("-1.0000 个百分点", results)
        self.assertIn("+1.0000 毫秒/张", results)
        self.assertIn("未在冻结评测中获得速度提升", results)

    def test_hash_mismatch_is_rejected_before_output_directory_creation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence = root / "raw.csv"
            evidence.write_text("tampered", encoding="utf-8")
            experiment = {"domain": "yolo_tradeoff", "ok": True, "status": "completed",
                "evaluation_opened": True, "independent_test": False, "test_opened": False,
                "recipe": {"image_sizes": [320, 480, 640]},
                "artifacts": [{"path": str(evidence), "sha256": "0" * 64}]}
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                build_yolo_chinese_report(root, experiment=experiment)
            self.assertFalse((root / "reading_zh").exists())

    def test_output_directory_cannot_escape_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            for directory in ("..", "../outside", str(Path(tmp) / "outside")):
                with self.assertRaises(ValueError):
                    build_yolo_chinese_report(tmp, experiment={}, directory_name=directory)

    def prepare_store(self, tmp):
        store = ResearchStore(Path(tmp))
        run, _ = store.create(RunRequest(goal="固定 YOLO 权重的尺寸精度速度实验", domain="yolo_tradeoff", request_id="chinese-version-test"))
        root = store.run_dir(run["id"])
        original = root / "paper.html"
        original.write_text("original English paper", encoding="utf-8")
        registered = store.artifact(run["id"], original, "html")
        store.update(run["id"], {"status": "completed", "progress": 100,
            "outputs": {"validation": {"frozen": True}, "reading": {"records": []}, "manuscript": {"revision": 3}},
            "artifacts": [registered]})
        target = root / "reading_zh"
        target.mkdir()
        paper = target / "paper.zh.html"
        paper.write_text("中文技术阅读稿", encoding="utf-8")
        manifest = target / "reading_zh.json"
        manifest.write_text("{}", encoding="utf-8")
        exported = {"status": "completed", "artifacts": [artifact(paper, "chinese_reading_html")],
                    "manifest": artifact(manifest, "chinese_reading_manifest")}
        return store, run["id"], original, exported

    def test_registration_is_append_only_and_repeated_export_adds_no_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, run_id, original, exported = self.prepare_store(tmp)
            try:
                before = copy.deepcopy(store.get(run_id))
                with patch("src.research.yolo_chinese_report.build_yolo_chinese_report", return_value=exported):
                    first = export_yolo_chinese_reading(store, run_id)
                    second = export_yolo_chinese_reading(store, run_id)
                after = store.get(run_id)
                self.assertEqual(first["newly_registered"], 2)
                self.assertEqual(second["newly_registered"], 0)
                for field in ("status", "progress", "stages", "budget", "summary", "error"):
                    self.assertEqual(before[field], after[field])
                for key in before["outputs"]:
                    self.assertEqual(before["outputs"][key], after["outputs"][key])
                self.assertEqual(before["artifacts"], after["artifacts"][:1])
                self.assertEqual(original.read_text(), "original English paper")
                events = [event for event in store.events(run_id)["events"] if event["type"] == "chinese_reading_exported"]
                self.assertEqual(len(events), 1)
            finally:
                store.close()

    def test_tampered_historical_artifact_blocks_new_export(self):
        with tempfile.TemporaryDirectory() as tmp:
            store, run_id, original, _ = self.prepare_store(tmp)
            try:
                original.write_text("changed", encoding="utf-8")
                with patch("src.research.yolo_chinese_report.build_yolo_chinese_report") as build:
                    with self.assertRaisesRegex(ValueError, "产物哈希变化"):
                        export_yolo_chinese_reading(store, run_id)
                    build.assert_not_called()
            finally:
                store.close()


class ReadingIntegrationTests(unittest.IsolatedAsyncioTestCase):
    """Exercise real revision/registration orchestration with document-only stubs."""

    def exporters(self):
        chinese_directories = []

        def english(output_dir, *, revision=1, **kwargs):
            directory = Path(output_dir) / ("manuscript" if revision == 1 else f"manuscript_v{revision}")
            directory.mkdir(exist_ok=True)
            paper = directory / "paper.html"
            paper.write_text(f"English report revision {revision}", encoding="utf-8")
            pdf = directory / "paper.pdf"
            pdf.write_bytes(f"document contract fixture {revision}".encode())
            manifest = directory / "manuscript.json"
            manifest.write_text(json.dumps({"revision": revision}), encoding="utf-8")
            return {"status": "completed", "revision": revision, "title": "English measured report",
                "quality": {"discussion": {"status": "raw_preserved"}},
                "pdf": {"status": "generated", "path": str(pdf)},
                "artifacts": [artifact(paper, "html"), artifact(pdf, "pdf")],
                "manifest": artifact(manifest, "manuscript_manifest")}

        def chinese(output_dir, *, directory_name, **kwargs):
            chinese_directories.append(directory_name)
            directory = Path(output_dir) / directory_name
            directory.mkdir(exist_ok=True)
            paper = directory / "paper.zh.html"
            paper.write_text("中文阅读稿", encoding="utf-8")
            manifest = directory / "reading_zh.json"
            manifest.write_text("{}", encoding="utf-8")
            return {"status": "completed", "language": "zh-CN",
                "artifacts": [artifact(paper, "chinese_reading_html")],
                "manifest": artifact(manifest, "chinese_reading_manifest")}

        return english, chinese, chinese_directories

    async def test_initial_revised_and_exported_editions_register_both_languages(self):
        from src.research.manuscript import build_manuscript
        from src.research.runtime import ResearchService
        with tempfile.TemporaryDirectory() as tmp:
            service = ResearchService(Path(tmp))
            try:
                run, _ = service.store.create(RunRequest(goal="YOLO precision and latency contract test",
                    domain="yolo_tradeoff", request_id="dual-reading-integration"))
                run_id = run["id"]
                root = service.store.run_dir(run_id)
                experiment = {"domain": "yolo_tradeoff"}
                service.store.finish_stage(run_id, "reading", {"records": []})
                service.store.finish_stage(run_id, "validation", experiment)
                english, chinese, directories = self.exporters()
                with patch("src.research.yolo_manuscript.build_yolo_manuscript", side_effect=english), \
                        patch("src.research.yolo_chinese_report.build_yolo_chinese_report", side_effect=chinese):
                    initial = build_manuscript(root, question=run["goal"], literature={"records": []},
                                               experiment=experiment, revision=1)
                    self.assertEqual(initial["default_reading_language"], "zh-CN")
                    self.assertEqual(initial["available_reading_languages"], ["zh-CN", "en"])
                    self.assertNotIn("language", initial)
                    self.assertEqual(Path(initial["pdf"]["path"]).name, "paper.pdf")
                    self.assertEqual(Path(initial["pdf"]["path"]).parent.name, "manuscript")
                    service.store.finish_stage(run_id, "manuscript", initial, service._register(run_id, initial))
                    revised = build_manuscript(root, question=run["goal"], literature={"records": []},
                                               experiment=experiment, revision=2)
                    review_output = {"revised_manuscript": revised,
                                     "artifacts": [*revised["artifacts"], revised["manifest"]]}
                    service.store.finish_stage(run_id, "review", review_output, service._register(run_id, review_output))
                    service.store.update(run_id, {"status": "completed", "outputs": {
                        **service.store.get(run_id)["outputs"], "manuscript": revised}})
                    before = service.store.get(run_id)
                    old_hashes = {item["path"]: item["sha256"] for item in before["artifacts"]}
                    exported = await service.export(run_id)
                self.assertEqual(directories, ["reading_zh_v1", "reading_zh_v2", "reading_zh_v3"])
                self.assertEqual(exported["outputs"]["manuscript"]["default_reading_language"], "zh-CN")
                self.assertEqual(exported["budget"], before["budget"])
                paths = {item["path"]: item for item in exported["artifacts"]}
                for revision in (1, 2, 3):
                    self.assertIn(f"reading_zh_v{revision}/paper.zh.html", paths)
                    self.assertIn(f"reading_zh_v{revision}/reading_zh.json", paths)
                for path, digest in old_hashes.items():
                    self.assertEqual(paths[path]["sha256"], digest)
                for item in exported["artifacts"]:
                    service.store.artifact_path(run_id, item["id"])
            finally:
                await service.shutdown()

    async def test_failed_english_export_keeps_failure_status_without_publishing_chinese(self):
        from src.research.manuscript import build_manuscript
        with tempfile.TemporaryDirectory() as tmp:
            failed = {"status": "partial", "pdf": {"status": "failed"}, "artifacts": []}
            with patch("src.research.yolo_manuscript.build_yolo_manuscript", return_value=failed), \
                    patch("src.research.yolo_chinese_report.build_yolo_chinese_report") as chinese:
                result = build_manuscript(tmp, question="YOLO study", literature=[], experiment={"domain": "yolo_tradeoff"})
            self.assertEqual(result, failed)
            chinese.assert_not_called()


if __name__ == "__main__":
    unittest.main()
