"""Real graph/checkpoint/API integration; only domain I/O is replaced."""
import asyncio
import tempfile
import unittest
from pathlib import Path

import httpx
from fastapi import FastAPI

from src.research.contracts import STAGES, Budget, RunRequest
from src.research.runtime import ResearchService
from src.web.routes.research_routes import router


class TinyService(ResearchService):
    def __init__(self, root, blocked=None, failure=None):
        super().__init__(root)
        self.calls = []
        self.blocked = blocked
        self.failure = failure
        self.started = asyncio.Event()

    async def _execute(self, run_id, stage, root, run):
        self.calls.append(stage)
        if stage == self.blocked:
            self.started.set()
            while self.blocked:
                self._boundary(run_id)
                await asyncio.sleep(.01)
        if stage == self.failure:
            self.failure = None
            raise ValueError("injected tool failure")
        path = root / (stage + ".txt")
        path.write_text(stage, encoding="utf-8")
        return {"stage_summary": stage, "artifacts": [{"path": str(path)}]}


class ResearchGraphTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.services = []

    async def asyncTearDown(self):
        for svc in self.services:
            if not svc.closing:
                await svc.shutdown()
        self.tmp.cleanup()

    async def service(self, **kwargs):
        svc = TinyService(self.root, **kwargs)
        self.services.append(svc)
        await svc.start()
        return svc

    def request(self, key="graph-test-0001"):
        return RunRequest(goal="Run a bounded reproducible classification study", request_id=key,
                          budget=Budget(max_seconds=60, model_calls=0, max_trials=18))

    async def test_real_graph_completes_and_idempotent_create_does_not_execute_twice(self):
        svc = await self.service()
        run = svc.create(self.request())
        completed = await svc.wait(run["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["progress"], 100)
        self.assertEqual(svc.calls, [s for s, _ in STAGES])
        duplicate = svc.create(self.request())
        self.assertEqual(duplicate["id"], run["id"])
        self.assertEqual(len(svc.calls), 12)
        snapshot = await svc.graph.aget_state({"configurable": {"thread_id": run["id"]}})
        self.assertFalse(snapshot.next)
        self.assertEqual(snapshot.values["last_stage"], "submission")

    async def test_default_runs_have_no_cumulative_caps_and_keep_actual_counts_after_recovery(self):
        svc = await self.service(failure="protocol")
        request = RunRequest(goal="Continue this research until its stages finish", request_id="no-limits-default-01")
        self.assertEqual(request.budget.model_dump(), {"max_seconds": None, "model_calls": None, "max_trials": None})
        run = svc.create(request)
        self.assertEqual((await svc.wait(run["id"]))["status"], "failed")
        svc.store.update(run["id"], mutate=lambda r: r["budget"].update(
            used_trials=99, used_model_calls=80, elapsed_seconds=1800))
        await svc.resume(run["id"], automatic=True)
        completed = await svc.wait(run["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["budget"]["used_model_calls"], 80)
        self.assertEqual(completed["budget"]["used_trials"], 99)
        self.assertGreaterEqual(completed["budget"]["elapsed_seconds"], 1800)
        self.assertEqual(completed["intervention_count"], 0)

    async def test_a_second_worker_cannot_recover_another_live_workers_run(self):
        svc = await self.service()
        with self.assertRaisesRegex(RuntimeError, "已有工作进程"):
            ResearchService(self.root)

    async def test_cancel_stops_current_tool_and_never_starts_later_stage(self):
        svc = await self.service(blocked="experiments")
        run = svc.create(self.request())
        await asyncio.wait_for(svc.started.wait(), 5)
        svc.cancel(run["id"])
        stopped = await asyncio.wait_for(svc.wait(run["id"]), 5)
        self.assertEqual(stopped["status"], "cancelled")
        self.assertNotIn("validation", svc.calls)
        self.assertIsNone(svc.store.operation(run["id"], "experiments"))

    async def test_failed_node_resumes_from_durable_checkpoint_without_repeating_completed_nodes(self):
        svc = await self.service(failure="protocol")
        run = svc.create(self.request())
        failed = await svc.wait(run["id"])
        self.assertEqual(failed["status"], "failed")
        svc.store.update(run["id"], mutate=lambda r: r["budget"].update(used_model_calls=2, used_trials=3))
        await svc.resume(run["id"])
        completed = await svc.wait(run["id"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(svc.calls.count("literature"), 1)
        self.assertEqual(svc.calls.count("protocol"), 2)
        self.assertEqual(completed["budget"]["used_trials"], 3)
        self.assertEqual(completed["intervention_count"], 1)

    async def test_service_restart_automatically_resumes_and_preserves_consumed_budget(self):
        first = await self.service(blocked="data")
        run = first.create(self.request())
        await asyncio.wait_for(first.started.wait(), 5)
        first.store.update(run["id"], mutate=lambda r: r["budget"].update(used_trials=4, used_model_calls=2))
        await first.shutdown()
        second = await self.service()
        finished = await second.wait(run["id"])
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(second.calls[0], "data")
        self.assertEqual(finished["budget"]["used_trials"], 4)
        self.assertEqual(finished["budget"]["used_model_calls"], 2)
        self.assertEqual(finished["intervention_count"], 0)
        self.assertEqual(finished["automatic_recoveries"], 1)
        self.assertGreaterEqual(finished["budget"]["elapsed_seconds"], first._segments[run["id"]][0])

    async def test_artifact_tampering_blocks_checkpoint_operation_reuse(self):
        svc = await self.service(failure="protocol")
        run = svc.create(self.request())
        await svc.wait(run["id"])
        (svc.store.run_dir(run["id"]) / "literature.txt").write_text("tampered")
        with self.assertRaises(ValueError):
            await svc._stage(run["id"], "literature")

    async def test_api_idempotency_busy_unknown_and_verified_download(self):
        svc = await self.service(blocked="literature")
        app = FastAPI()
        app.include_router(router)
        app.state.research = svc
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            body = self.request().model_dump()
            first = await client.post("/api/research/runs", json=body)
            self.assertEqual(first.status_code, 202)
            duplicate = await client.post("/api/research/runs", json=body)
            self.assertEqual(first.json()["id"], duplicate.json()["id"])
            changed = await client.post("/api/research/runs", json={**body, "goal": "Changed study objective"})
            self.assertEqual(changed.status_code, 409)
            busy = await client.post("/api/research/runs", json={**body, "request_id": "another-key-01"})
            self.assertEqual(busy.status_code, 409)
            self.assertEqual((await client.get("/api/research/runs/unknown")).status_code, 404)
            run_id = first.json()["id"]
            svc.blocked = None
            finished = await svc.wait(run_id)
            artifact = finished["artifacts"][0]
            response = await client.get(artifact["url"])
            self.assertEqual(response.status_code, 200)
            path = svc.store.artifact_path(run_id, artifact["id"])
            path.write_text("changed")
            self.assertEqual((await client.get(artifact["url"])).status_code, 409)
            self.assertEqual((await client.get(f"/api/research/runs/{run_id}/artifacts/unknown")).status_code, 404)


if __name__ == "__main__":
    unittest.main()
