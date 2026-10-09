"""digits实验划分、执行与测量证据回归。"""
import asyncio
import copy
import csv
import json
import tempfile
import unittest
from pathlib import Path

import httpx
from pydantic import ValidationError

from src.research.domain import (
    ResearchRecipe, confirm_results, prepare_dataset, run_baseline,
    run_experiments, sha256_file, validate_recipe,
)
from src.research.literature import acquire_full_text, search_literature
from src.research.manuscript import build_manuscript, audit_discussion


class ResearchDomainTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temporary.name)
        cls.recipe = {"seeds": [3, 17, 29], "candidates": [{"algorithm": "random_forest", "trees": 16, "max_depth": 6, "augmentation_std": 0.2}]}
        cls.prepared = prepare_dataset(cls.directory, cls.recipe)
        cls.baseline = run_baseline(cls.directory, cls.recipe)
        cls.search = run_experiments(cls.directory, cls.recipe, phase="search")
        cls.selection_bytes = (cls.directory / "experiments" / "selection.json").read_bytes()
        cls.confirmed = confirm_results(cls.directory, cls.recipe)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_declarative_schema_rejects_code_and_construct_bypass(self):
        with self.assertRaises(ValidationError):
            validate_recipe({"python": "__import__('os').system('whoami')"})
        with self.assertRaises(ValidationError):
            validate_recipe({"candidates": [{"algorithm": "arbitrary_python"}]})
        with self.assertRaises(ValidationError):
            validate_recipe(ResearchRecipe.model_construct(seeds=[1, 1, 1]))
        with self.assertRaises(ValidationError):
            validate_recipe({"seeds": [1, 2]})

    def test_actual_splits_are_disjoint_and_complete(self):
        self.assertEqual(self.prepared["samples"], 1797)
        splits = json.loads((self.directory / "experiments" / "splits.json").read_text())
        for split in splits.values():
            train, validation, test = map(set, (split["train"], split["validation"], split["test"]))
            self.assertFalse(train & validation or train & test or validation & test)
            self.assertEqual(train | validation | test, set(range(1797)))
        self.assertEqual(splits["3"], splits["17"])
        self.assertEqual(splits["3"], splits["29"])
        test_union = {index for split in splits.values() for index in split["test"]}
        search_union = {index for split in splits.values() for key in ("train", "validation") for index in split[key]}
        self.assertFalse(test_union & search_union)

    def test_search_never_queries_final_test_and_selection_is_frozen(self):
        self.assertFalse(self.prepared["test_opened"])
        self.assertFalse(self.baseline["test_opened"])
        self.assertFalse(self.search["test_opened"])
        self.assertTrue(self.confirmed["test_opened"])
        with (self.directory / "experiments" / "metrics_search.csv").open(newline="") as stream:
            self.assertEqual({row["split"] for row in csv.DictReader(stream)}, {"validation"})
        self.assertEqual((self.directory / "experiments" / "selection.json").read_bytes(), self.selection_bytes)
        with (self.directory / "experiments" / "metrics.csv").open(newline="") as stream:
            rows = list(csv.DictReader(stream))
        self.assertEqual(len(rows), 18)
        self.assertEqual({row["split"] for row in rows}, {"test"})

    def test_completed_confirmation_reuses_without_a_second_fit(self):
        repeated = confirm_results(self.directory, self.recipe)
        self.assertTrue(repeated["reused"])
        self.assertEqual(repeated["fit_count"], self.confirmed["fit_count"])
        self.assertEqual(repeated["summary"], self.confirmed["summary"])

    def test_trial_budget_prevents_start_and_cancel_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                run_experiments(directory, self.recipe, max_trials=2)
            cancelled = run_experiments(directory, self.recipe, cancelled=lambda: True, phase="search")
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(cancelled["fit_count"], 0)
            self.assertFalse(cancelled["test_opened"])

    def test_persistent_fit_budget_callback_stops_and_preserves_partial_evidence(self):
        charged = []
        def charge():
            if charged:
                raise RuntimeError("persistent trial budget exhausted")
            charged.append(1)
        with tempfile.TemporaryDirectory() as directory:
            baseline = run_baseline(directory, self.recipe, before_fit=charge)
            self.assertEqual(baseline["status"], "failed")
            self.assertEqual(baseline["fit_count"], 1)
            self.assertIn("budget exhausted", baseline["error"])
            self.assertTrue(Path(baseline["artifacts"][0]["path"]).exists())

    def test_manuscript_verifies_measured_values_and_exports_real_documents(self):
        forged = copy.deepcopy(self.confirmed)
        forged["summary"][0]["accuracy_mean"] = 1.0
        with self.assertRaises(ValueError):
            build_manuscript(self.directory, question="test goal", literature=[], experiment=forged)
        report = build_manuscript(self.directory, question="Digits augmentation robustness", literature=[], experiment=self.confirmed, analysis="Unverified model explanation")
        self.assertEqual(report["quality"]["numeric_integrity"], "verified_against_raw_csv")
        self.assertEqual(report["quality"]["novelty"], "novelty_unverified")
        self.assertEqual(report["pdf"]["status"], "generated")
        from pypdf import PdfReader
        reader = PdfReader(report["pdf"]["path"])
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        self.assertIn(f"{report['summary'][0]['accuracy_mean']:.4f}", text)
        self.assertIn("Candidate report", text)
        self.assertFalse(report["pdf"]["tex_compiled"])
        import zipfile
        with zipfile.ZipFile(self.directory / "manuscript" / "submission_bundle.zip") as archive:
            self.assertIn("MANIFEST.sha256", archive.namelist())
            self.assertIn("experiments/fixed_runner.py", archive.namelist())
            self.assertIn("experiments/metrics.csv", archive.namelist())
        for item in report["artifacts"]:
            self.assertEqual(sha256_file(item["path"]), item["sha256"])

    def test_model_discussion_uses_recorded_numbers_and_withholds_unrecorded_claims(self):
        value = self.confirmed["summary"][0]["accuracy_mean"]
        prose = {"interpretation": f"The recorded control accuracy is {value*100:.2f}%.", "limitations": ["Small fixed holdout."]}
        text, audit = audit_discussion(prose, self.confirmed["summary"], self.confirmed["recipe"])
        self.assertIn(f"{value*100:.2f}%", text)
        self.assertEqual(audit["status"], "numeric_tokens_checked")
        forged = {"interpretation": "The score was 999.999. Another claim was 888.888%.", "limitations": []}
        text, audit = audit_discussion(forged, self.confirmed["summary"], self.confirmed["recipe"])
        self.assertEqual(text, "")
        self.assertEqual(audit["unknown_tokens"], ["999.999", "888.888"])

    def test_new_manuscript_version_keeps_prior_files_and_reuses_identical_export(self):
        prose = {"interpretation": "This measured trade-off only applies to the tested protocol.", "limitations": []}
        report = build_manuscript(self.directory, question="Version test", literature=[], experiment=self.confirmed, analysis=prose, revision=4)
        pdf = Path(report["pdf"]["path"])
        original = pdf.read_bytes()
        self.assertIn("Model-assisted Discussion", pdf.with_suffix(".md").read_text())
        repeated = build_manuscript(self.directory, question="Version test", literature=[], experiment=self.confirmed, analysis=prose, revision=4)
        self.assertTrue(repeated["reused"])
        with self.assertRaisesRegex(ValueError, "immutable"):
            build_manuscript(self.directory, question="Changed goal", literature=[], experiment=self.confirmed, analysis=prose, revision=4)
        self.assertEqual(pdf.read_bytes(), original)


class LiteratureAcquisitionTests(unittest.TestCase):
    def test_failed_source_is_preserved_without_invented_records(self):
        # Explicit protocol fixture, not a saved research result.
        atom = """<feed xmlns='http://www.w3.org/2005/Atom'><entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Protocol test record</title><published>2024-01-01</published><summary>Fixture abstract.</summary><author><name>Fixture Author</name></author></entry></feed>"""
        def handler(request):
            return httpx.Response(500) if request.url.host == "api.crossref.org" else httpx.Response(200, text=atom)
        async def scenario(directory):
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await search_literature("digits robustness", directory, client=client)
        with tempfile.TemporaryDirectory() as directory:
            result = asyncio.run(scenario(directory))
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["records"]), 1)
        self.assertEqual(result["sources"][0]["status"], "failed")
        self.assertEqual(result["records"][0]["reading_scope"], "metadata_and_abstract")

    def test_non_pdf_and_metadata_only_never_claim_full_text(self):
        records = [{"id": "doi:example", "source": "crossref", "arxiv_id": None}, {"id": "arxiv:2401.00001", "arxiv_id": "2401.00001"}]
        async def scenario(directory):
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text="not a PDF"))) as client:
                return await acquire_full_text(records, directory, client=client)
        with tempfile.TemporaryDirectory() as directory:
            result = asyncio.run(scenario(directory))
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["records"][0]["full_text_status"], "metadata_only")
        self.assertEqual(result["records"][1]["full_text_status"], "failed")


if __name__ == "__main__":
    unittest.main()
