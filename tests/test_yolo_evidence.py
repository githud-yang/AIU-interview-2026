from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from src.yolo.evidence import archive_run, dataset_fingerprint, sha256


class EvidenceTests(unittest.TestCase):
    def test_completed_run_archive_copies_and_hashes_actual_artifacts(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            (run / "weights").mkdir(parents=True)
            (run / "weights/best.pt").write_bytes(b"real-fixture-weights")
            (run / "results.csv").write_text("epoch, metrics/mAP50(B)\n1, 0.1\n2, 0.3\n", encoding="utf-8")
            (run / "results.png").write_bytes(b"figure")
            summary = archive_run(run, parameters={"seed": 42}, output_weights=root / "best.pt", summary_path=root / "result.json", evidence_dir=root / "evidence")
            self.assertEqual(summary["completed_epochs"], 2)
            self.assertIsNone(summary["completed_at"])
            self.assertTrue(summary["archived_at"])
            self.assertEqual(summary["metrics_origin"], "last_epoch_csv")
            self.assertEqual(summary["metrics"]["metrics/mAP50(B)"], 0.3)
            self.assertEqual(summary["weights_sha256"], sha256(root / "best.pt"))
            manifest = json.loads((Path(summary["evidence_dir"]) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["weights_sha256"], summary["weights_sha256"])
            for artifact in summary["artifacts"]:
                self.assertEqual(artifact["sha256"], sha256(Path(summary["evidence_dir"]) / artifact["file"]))

    def test_incomplete_or_empty_run_is_rejected(self):
        with TemporaryDirectory() as temporary:
            run = Path(temporary)
            with self.assertRaises(ValueError):
                archive_run(run, parameters={})
            (run / "weights").mkdir()
            (run / "weights/best.pt").write_bytes(b"weights")
            (run / "results.csv").write_text("epoch,metrics/mAP50(B)\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                archive_run(run, parameters={})

    def test_dataset_hash_changes_with_label_content(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "labels").mkdir()
            label = root / "labels/a.txt"
            label.write_text("0 .5 .5 .1 .1", encoding="utf-8")
            first = dataset_fingerprint({"path": root})
            label.write_text("1 .5 .5 .1 .1", encoding="utf-8")
            second = dataset_fingerprint({"path": root})
            self.assertNotEqual(first["manifest_sha256"], second["manifest_sha256"])
            self.assertEqual(second["file_count"], 1)

    def test_archive_preserves_prior_validation_metrics_for_same_run(self):
        with TemporaryDirectory() as temporary:
            run = Path(temporary)
            (run / "weights").mkdir()
            (run / "weights/best.pt").write_bytes(b"weights")
            (run / "results.csv").write_text("epoch,metrics/mAP50(B)\n1,0.1\n", encoding="utf-8")
            saved = run / "summary.json"
            saved.write_text(json.dumps({"run_dir": str(run), "metrics": {"metrics/mAP50(B)": 0.9}, "completed_at": "2026-10-07T00:00:00Z"}), encoding="utf-8")
            summary = archive_run(run, parameters={}, summary_path=saved)
            self.assertEqual(summary["metrics"]["metrics/mAP50(B)"], 0.9)
            self.assertEqual(summary["last_epoch_metrics"]["metrics/mAP50(B)"], 0.1)
            self.assertEqual(summary["metrics_origin"], "best_checkpoint_validation_legacy_summary")
            self.assertEqual(summary["completed_at"], "2026-10-07T00:00:00Z")
            self.assertEqual(summary["environment_origin"], "archive_runtime")

    def test_missing_dataset_root_does_not_fingerprint_current_directory(self):
        self.assertFalse(dataset_fingerprint({})["fingerprint_available"])

    def test_changed_weights_do_not_inherit_old_best_metrics(self):
        with TemporaryDirectory() as temporary:
            run = Path(temporary)
            (run / "weights").mkdir()
            (run / "weights/best.pt").write_bytes(b"new-weights")
            (run / "results.csv").write_text("epoch,metrics/mAP50(B)\n1,0.1\n", encoding="utf-8")
            saved = run / "summary.json"
            saved.write_text(json.dumps({"run_dir": str(run), "weights_sha256": "different-old-hash", "metrics": {"metrics/mAP50(B)": 0.9}}), encoding="utf-8")
            summary = archive_run(run, parameters={}, summary_path=saved)
            self.assertEqual(summary["metrics_origin"], "last_epoch_csv")
            self.assertEqual(summary["metrics"]["metrics/mAP50(B)"], 0.1)

    def test_current_dataset_snapshot_keeps_archive_origin(self):
        with TemporaryDirectory() as temporary:
            run = Path(temporary)
            (run / "weights").mkdir()
            (run / "weights/best.pt").write_bytes(b"weights")
            (run / "results.csv").write_text("epoch,metrics/mAP50(B)\n1,0.1\n", encoding="utf-8")
            saved = run / "summary.json"
            saved.write_text(json.dumps({"run_dir": str(run), "metrics": {"metrics/mAP50(B)": 0.9}, "dataset": {"old": True}, "dataset_origin": "training_runtime"}), encoding="utf-8")
            summary = archive_run(run, parameters={}, summary_path=saved, dataset={"current": True})
            self.assertEqual(summary["dataset"], {"current": True})
            self.assertEqual(summary["dataset_origin"], "archive_runtime")


if __name__ == "__main__":
    unittest.main()
