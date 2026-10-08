"""SQLite integration checks using disposable databases and real artifact files."""
import hashlib
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from src.research.contracts import Budget, RunRequest, STAGES
from src.research.store import ResearchStore


class ResearchStoreTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.stores = [ResearchStore(self.root)]
        self.store = self.stores[0]

    def tearDown(self):
        for store in self.stores:
            store.close()
        self.temporary.cleanup()

    def request(self, request_id="request-0001", **changes):
        return RunRequest(
            **{"goal": "Evaluate digits robustness with matched controls", "request_id": request_id, **changes}
        )

    def create(self, request_id="request-0001", **changes):
        return self.store.create(self.request(request_id, **changes))[0]

    def another_store(self):
        store = ResearchStore(self.root)
        self.stores.append(store)
        return store

    def finish_run(self, run_id):
        self.store.update(run_id, {"status": "completed"})

    def register_artifact(self, run_id, name="report.md", content="measured result"):
        file = self.store.run_dir(run_id) / name
        file.write_text(content, encoding="utf-8")
        record = self.store.artifact(run_id, file, "report")
        self.store.finish_stage(run_id, "manuscript", {"report": record["id"]}, [record])
        return file, record

    def test_identical_request_id_returns_existing_run_without_duplicate_event(self):
        request = self.request()
        original, created = self.store.create(request)
        replay, created_again = self.store.create(request)
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(original["id"], replay["id"])
        self.assertEqual(len(self.store.list_runs()), 1)
        self.assertEqual(len(self.store.events(original["id"])["events"]), 1)

    def test_request_id_with_changed_payload_raises_conflict_value_error(self):
        original = self.create()
        for changes in ({"goal": "A different research question"}, {"budget": Budget(max_trials=24)}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, "request_id"):
                self.store.create(self.request(**changes))
        self.assertEqual(self.store.get(original["id"])["goal"], original["goal"])
        self.assertEqual(len(self.store.list_runs()), 1)

    def test_unique_active_run_is_enforced_across_independent_connections(self):
        second = self.another_store()
        rendezvous = threading.Barrier(2)

        def create(store, identity):
            rendezvous.wait(timeout=3)
            try:
                run, created = store.create(self.request(identity))
                return "created", run["id"], created
            except ValueError as exc:
                return "conflict", str(exc), False

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(create, self.store, "concurrent-first")
            other = pool.submit(create, second, "concurrent-second")
            outcomes = [first.result(timeout=10), other.result(timeout=10)]
        self.assertEqual(sorted(result[0] for result in outcomes), ["conflict", "created"])
        saved = self.store.list_runs()
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]["status"], "queued")
        self.assertEqual(len(self.store.events(saved[0]["id"])["events"]), 1)

    def test_new_run_can_start_after_previous_run_becomes_terminal(self):
        run = self.create()
        self.finish_run(run["id"])
        second, created = self.store.create(self.request("request-0002"))
        self.assertTrue(created)
        self.assertNotEqual(second["id"], run["id"])
        with self.assertRaises(ValueError):
            self.store.create(self.request("request-0003"))

    def test_stage_output_operation_and_event_commit_together(self):
        run = self.create()
        output = {"paper_ids": ["verified-paper-1"], "scope": "abstract only"}
        finished = self.store.finish_stage(run["id"], "literature", output, summary="One metadata record")
        self.assertEqual(finished["outputs"]["literature"], output)
        self.assertEqual(self.store.operation(run["id"], "literature"), output)
        self.assertEqual(finished["stages"][0]["status"], "completed")
        self.assertEqual(finished["progress"], round(100 / len(STAGES)))
        events = self.store.events(run["id"])["events"]
        self.assertEqual(events[-1]["type"], "stage_completed")
        self.assertEqual(events[-1]["stage"], "literature")
        reopened = self.another_store()
        self.assertEqual(reopened.operation(run["id"], "literature"), output)
        self.assertEqual(reopened.get(run["id"])["outputs"]["literature"], output)

    def test_stage_event_failure_rolls_back_output_and_operation(self):
        run = self.create()
        before = self.store.get(run["id"])
        old_events = self.store.events(run["id"])
        with patch.object(self.store, "_event", side_effect=OSError("injected journal failure")):
            with self.assertRaises(OSError):
                self.store.finish_stage(run["id"], "literature", {"papers": []})
        self.assertEqual(self.store.get(run["id"]), before)
        self.assertIsNone(self.store.operation(run["id"], "literature"))
        self.assertEqual(self.store.events(run["id"]), old_events)

    def test_update_event_failure_rolls_back_run_mutation(self):
        run = self.create()
        with patch.object(self.store, "_event", side_effect=OSError("injected event failure")):
            with self.assertRaises(OSError):
                self.store.update(run["id"], {"status": "running"}, event={"type": "model_start"})
        self.assertEqual(self.store.get(run["id"])["status"], "queued")
        self.assertEqual(len(self.store.events(run["id"])["events"]), 1)

    def test_finished_operation_is_reused_without_overwrite_or_duplicate_event(self):
        run = self.create()
        output = {"papers": ["verified-paper"]}
        self.store.finish_stage(run["id"], "literature", output, summary="completed")
        before = self.store.events(run["id"])
        self.store.finish_stage(run["id"], "literature", output, summary="completed")
        self.assertEqual(self.store.operation(run["id"], "literature"), output)
        self.assertEqual(self.store.events(run["id"]), before)
        with self.assertRaises(ValueError):
            self.store.finish_stage(run["id"], "literature", {"papers": ["different-result"]})
        self.assertEqual(self.store.operation(run["id"], "literature"), output)

    def test_unknown_stage_cannot_create_a_completed_operation(self):
        run = self.create()
        with self.assertRaises(ValueError):
            self.store.finish_stage(run["id"], "invented_stage", {"ok": True})
        self.assertIsNone(self.store.operation(run["id"], "invented_stage"))
        self.assertEqual(self.store.get(run["id"])["progress"], 0)

    def test_restart_preserves_results_and_consumed_budget(self):
        run = self.create()
        self.store.finish_stage(run["id"], "literature", {"papers": ["p1"]})
        self.store.update(run["id"], {"status": "running"}, mutate=lambda state: state["budget"].update(
            used_model_calls=3, used_trials=6, elapsed_seconds=42.5
        ))
        reopened = self.another_store()
        reopened.mark_stale()
        recovered = reopened.get(run["id"])
        self.assertEqual(recovered["status"], "interrupted")
        self.assertEqual(recovered["outputs"]["literature"], {"papers": ["p1"]})
        self.assertEqual(reopened.operation(run["id"], "literature"), {"papers": ["p1"]})
        self.assertEqual(recovered["budget"]["used_model_calls"], 3)
        self.assertEqual(recovered["budget"]["used_trials"], 6)
        self.assertEqual(recovered["budget"]["elapsed_seconds"], 42.5)
        self.assertEqual(reopened.events(run["id"])["events"][-1]["type"], "service_recovery")

    def test_restart_honors_previous_cancellation_request(self):
        run = self.create()
        self.store.update(run["id"], {"status": "cancelling", "cancel_requested": True})
        self.another_store().mark_stale()
        self.assertEqual(self.store.get(run["id"])["status"], "cancelled")

    def test_event_sequences_are_monotonic_and_incremental_queries_do_not_repeat(self):
        run = self.create()
        for count in range(4):
            self.store.event(run["id"], type="observed", data={"number": count})
        first_page = self.store.events(run["id"], limit=2)
        second_page = self.store.events(run["id"], after_seq=first_page["last_seq"])
        combined = first_page["events"] + second_page["events"]
        sequences = [event["seq"] for event in combined]
        self.assertEqual(sequences, sorted(set(sequences)))
        self.assertEqual(len(combined), 5)
        empty = self.store.events(run["id"], after_seq=second_page["last_seq"])
        self.assertEqual(empty["events"], [])
        self.assertEqual(empty["last_seq"], second_page["last_seq"])
        with self.assertRaises(KeyError):
            self.store.events("missing-run")

    def test_event_filter_does_not_expose_another_run(self):
        first = self.create()
        self.store.event(first["id"], type="private", message="first run")
        self.finish_run(first["id"])
        second = self.create("request-0002")
        events = self.store.events(second["id"])["events"]
        self.assertEqual(len(events), 1)
        self.assertFalse(any(event["message"] == "first run" for event in events))

    def test_artifact_registration_and_access_check_hash_and_run_ownership(self):
        first = self.create()
        file, record = self.register_artifact(first["id"])
        self.assertEqual(self.store.artifact_path(first["id"], record["id"]), file.resolve())
        self.assertEqual(record["sha256"], hashlib.sha256(file.read_bytes()).hexdigest())
        self.finish_run(first["id"])
        second = self.create("request-0002")
        with self.assertRaises(ValueError):
            self.store.artifact(second["id"], file)
        with self.assertRaises(KeyError):
            self.store.artifact_path(second["id"], record["id"])
        file.write_text("tampered numerical claim", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "哈希"):
            self.store.artifact_path(first["id"], record["id"])

    def test_artifact_registration_rejects_external_and_missing_files(self):
        run = self.create()
        outside = self.root / "outside.json"
        outside.write_text("{}", encoding="utf-8")
        for file in (outside, self.store.run_dir(run["id"]) / "missing.json", self.store.run_dir(run["id"])):
            with self.subTest(file=file), self.assertRaises(ValueError):
                self.store.artifact(run["id"], file)

    def test_tampered_artifact_record_cannot_escape_run_directory(self):
        run = self.create()
        _, record = self.register_artifact(run["id"])
        outside = self.root / "secret.json"
        outside.write_text("private", encoding="utf-8")
        self.store.update(run["id"], mutate=lambda state: state["artifacts"][0].update(
            path="../../secret.json", sha256=hashlib.sha256(outside.read_bytes()).hexdigest()
        ))
        with self.assertRaises(KeyError):
            self.store.artifact_path(run["id"], record["id"])

    def test_pending_stages_and_pending_request_are_not_completed_interventions(self):
        run = self.create()
        self.assertTrue(all(stage["status"] == "pending" for stage in run["stages"]))
        self.assertEqual(run["intervention_count"], 0)
        self.store.update(run["id"], {
            "status": "needs_intervention",
            "interventions": [{"status": "pending", "reason": "research direction clarification requested"}],
        })
        pending = self.store.get(run["id"])
        self.assertEqual(pending["intervention_count"], 0)
        self.assertEqual(pending["interventions"][0]["status"], "pending")


if __name__ == "__main__":
    unittest.main()
