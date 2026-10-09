"""YOLO evidence boundaries, without GPU, downloads or cloud credentials."""
import asyncio
import csv
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from src.research.yolo_domain import (COCO_NAMES, _safe_extract, _split_ids,
                                       select_candidate, summarize_samples)
from src.research import yolo_domain
from src.research.runtime import ResearchService
from src.web.main import create_app


class YoloEvidenceTests(unittest.TestCase):
    def prepare_fixture(self, temporary: str):
        """Exercise real preparation using local fake bytes, without loading them."""
        base = Path(temporary)
        project, cache, root = base / "project", base / "cache", base / "run"
        weights = project / "assets" / "models" / "best.pt"
        weights.parent.mkdir(parents=True)
        weights.write_bytes(b"fixture checkpoint; never loaded")
        records = []
        for number in range(40):
            identifier = f"{number:012d}"
            image = cache / "coco128" / "images" / "train2017" / (identifier + ".jpg")
            label = cache / "coco128" / "labels" / "train2017" / (identifier + ".txt")
            image.parent.mkdir(parents=True, exist_ok=True)
            label.parent.mkdir(parents=True, exist_ok=True)
            image.write_bytes(f"fixture image {number}; never decoded".encode())
            label.write_text("", encoding="utf-8")
            records.append({"image_id": identifier,
                            "image": image.relative_to(cache / "coco128").as_posix(),
                            "label": label.relative_to(cache / "coco128").as_posix(),
                            "image_sha256": yolo_domain.sha256_file(image),
                            "label_sha256": yolo_domain.sha256_file(label)})
        manifest = {"dataset": "coco128", "source_url": yolo_domain.COCO128_URL,
                    "archive_sha256": "0" * 64, "records": records, "excluded_missing_annotation": []}
        with patch.object(yolo_domain, "PROJECT", project), \
                patch.object(yolo_domain, "_cache_dataset", return_value=(cache, manifest)), \
                patch.object(yolo_domain, "_known_coco8_images", return_value=(set(), [])):
            prepared = yolo_domain.prepare_yolo_data(root)
        return root, prepared

    def test_first_preparation_and_unchanged_source_resume_preserve_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, prepared = self.prepare_fixture(tmp)
            self.assertTrue(prepared["ok"])
            yolo_domain.verify_runner_source(root)
            before = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}
            with patch.object(yolo_domain, "_cache_dataset", side_effect=AssertionError("Resume must reuse frozen data")):
                resumed = yolo_domain.prepare_yolo_data(root)
            self.assertTrue(resumed["reused"])
            self.assertEqual(resumed["artifacts"], prepared["artifacts"])
            self.assertEqual(before, {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()})

    def test_changed_source_blocks_resume_phase_and_job_before_writes_or_charging(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, _ = self.prepare_fixture(tmp)
            changed = Path(tmp) / "changed_yolo_domain.py"
            changed.write_bytes(Path(yolo_domain.__file__).read_bytes() + b"\n# simulated newer execution version\n")
            before = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}
            with patch.object(yolo_domain, "__file__", str(changed)), \
                    patch.object(yolo_domain, "_environment", side_effect=AssertionError("Do not load runtime dependencies")), \
                    patch.object(yolo_domain, "_cache_dataset", side_effect=AssertionError("Do not download")):
                for operation in (lambda: yolo_domain.prepare_yolo_data(root),
                                  lambda: yolo_domain.run_yolo_phase(root, phase="baseline"),
                                  lambda: yolo_domain._job(root, "selection", 640, {}, {}, None,
                                      lambda: self.fail("Changed source must not charge an experiment job"))):
                    with self.assertRaisesRegex(ValueError, "执行源码与冻结runner不一致.*旧产物已保留"):
                        operation()
            self.assertFalse((root / "experiments" / "jobs").exists())
            self.assertEqual(before, {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()})

    def test_coco_class_mapping_retains_all_eighty_ids(self):
        self.assertEqual(len(COCO_NAMES), 80)
        self.assertEqual(COCO_NAMES[59:63], ["bed", "dining table", "toilet", "tv"])
        self.assertEqual(COCO_NAMES[79], "toothbrush")

    def test_split_is_stable_disjoint_and_rejects_duplicates(self):
        ids = [f"{i:012d}" for i in range(40)]
        first = _split_ids(ids)
        self.assertEqual(first, _split_ids(list(reversed(ids))))
        self.assertFalse(set(first["selection"]) & set(first["evaluation"]))
        self.assertEqual(set(first["selection"] + first["evaluation"]), set(ids))
        with self.assertRaises(ValueError):
            _split_ids(ids + ids[:1])

    def test_selection_rejects_fast_but_inaccurate_configuration(self):
        rows = [{"imgsz": size, "split": "selection", "map50_95": score, "latency_ms": latency}
                for size, score, latency in [(320, .40, 1), (480, .69, 2), (640, .70, 3)]]
        self.assertEqual(select_candidate(rows), 480)
        rows[1]["split"] = "evaluation"
        with self.assertRaises(ValueError):
            select_candidate(rows)

    def test_raw_latency_rejects_duplicates_and_cross_split_samples(self):
        protocol = {"splits": {"selection": ["image-a"], "evaluation": ["image-b"]}}
        row = {"split": "selection", "imgsz": 640, "map50": .8, "map50_95": .6, "precision": .7, "recall": .7}
        samples = [{"model": "yolo_imgsz640", "split": "selection", "imgsz": 640,
                    "repeat": repeat, "sample": i, "image_id": "image-a", "latency_ms": 10 + i}
                   for repeat in range(3) for i in range(10)]
        result = summarize_samples(row, samples, protocol)
        self.assertAlmostEqual(result["latency_ms"], 14.5)
        self.assertAlmostEqual(result["fps"], 1000 / 14.5)
        samples[-1] = samples[0]
        with self.assertRaises(ValueError):
            summarize_samples(row, samples, protocol)
        samples[-1] = {**samples[0], "image_id": "image-b"}
        with self.assertRaises(ValueError):
            summarize_samples(row, samples, protocol)

    def test_archive_cannot_escape_owned_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = root / "bad.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("../outside.txt", "no")
            with self.assertRaises(ValueError):
                _safe_extract(archive, root / "extract")
            self.assertFalse((root / "outside.txt").exists())

    def test_curated_planning_routes_do_not_accept_arbitrary_files(self):
        with tempfile.TemporaryDirectory() as tmp, TestClient(create_app(research_root=Path(tmp))) as c:
            self.assertEqual(c.get('/research/strategy').status_code, 200)
            text = c.get('/api/research/planning/brief').text
            self.assertIn('不受理投稿前咨询', text)
            self.assertIn('尚未系统阅读', text)
            self.assertEqual(c.get('/api/research/planning/editor-draft').status_code, 200)
            self.assertEqual(c.get('/api/research/planning/unknown').status_code, 404)


class YoloDispatchTests(unittest.IsolatedAsyncioTestCase):
    async def test_submission_packaging_does_not_require_digits_recipe(self):
        from src.research.contracts import RunRequest
        with tempfile.TemporaryDirectory() as tmp:
            service = ResearchService(Path(tmp))
            try:
                run, _ = service.store.create(RunRequest(goal='YOLO speed accuracy study', domain='yolo_tradeoff', request_id='package-yolo-0001'))
                root = Path(tmp) / 'package'
                root.mkdir()
                (root / 'project_goal.txt').write_text(run['goal'], encoding='utf-8')
                with patch.object(service, '_output', side_effect=AssertionError('Packaging must not require a training recipe')):
                    result = await service._execute(run['id'], 'submission', root, run)
                self.assertEqual(result['status'], 'not_submitted')
                with zipfile.ZipFile(root / 'research_bundle.zip') as archive:
                    self.assertIn('submission_status.json', archive.namelist())
                    self.assertIn('project_goal.txt', archive.namelist())
            finally:
                await service.shutdown()

    async def test_yolo_stage_dispatch_cannot_fall_back_to_digits(self):
        with tempfile.TemporaryDirectory() as tmp:
            service = ResearchService(Path(tmp))
            try:
                expected = {"domain": "yolo_tradeoff", "training_fits": 0}
                with patch('src.research.yolo_workflow.execute_yolo_stage', AsyncMock(return_value=expected)) as execute:
                    actual = await service._execute('id', 'protocol', Path(tmp), {'domain': 'yolo_tradeoff'})
                    self.assertEqual(actual, expected)
                    execute.assert_awaited_once()
            finally:
                await service.shutdown()

    async def test_yolo_trial_is_recorded_as_evaluation_without_training_claim(self):
        from src.research.contracts import RunRequest
        with tempfile.TemporaryDirectory() as tmp:
            service = ResearchService(Path(tmp))
            try:
                run, _ = service.store.create(RunRequest(goal='YOLO speed accuracy study', domain='yolo_tradeoff', request_id='charge-yolo-0001'))
                service.deadlines[run['id']] = float('inf')
                service._before_yolo_trial(run['id'])
                self.assertEqual(service.store.get(run['id'])['budget']['used_trials'], 1)
                events = service.store.events(run['id'], 0)['events']
                self.assertIn('不进行训练', events[-1]['message'])
            finally:
                await service.shutdown()
