"""SSE delivery, cursor replay and disconnect tests; no models or research jobs."""
import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.research.contracts import RunRequest
from src.research.store import ResearchStore
from src.web.routes.research_routes import router, subscribe_run
from src.web.services.research_stream import reconnect_cursor, research_events


def payload(frame):
    return json.loads(next(line[6:] for line in frame.splitlines() if line.startswith("data: ")))


class Disconnection:
    closed = False

    async def is_disconnected(self):
        return self.closed


class ResearchStreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = ResearchStore(Path(self.temporary.name))
        self.run, _ = self.store.create(RunRequest(goal="Compare research records", request_id="stream-test-0001"))
        self.request = Disconnection()

    async def asyncTearDown(self):
        self.store.close()
        self.temporary.cleanup()

    async def test_initial_snapshot_then_only_changed_fields_and_new_events(self):
        stream = research_events(self.store, self.run["id"], self.request, interval=0, heartbeat=0)
        self.assertEqual(await anext(stream), "retry: 2000\n\n")
        first = payload(await anext(stream))
        self.assertEqual(first["run"], self.run)
        initial_events = payload(await anext(stream))
        self.assertEqual([event["seq"] for event in initial_events["events"]], [1])
        self.assertEqual(await anext(stream), ": heartbeat\n\n")
        self.store.update(self.run["id"], {"status": "running"}, event={"message": "开始执行"})
        changed = payload(await anext(stream))
        self.assertEqual(changed["changes"]["status"], "running")
        self.assertNotIn("artifacts", changed["changes"])
        self.assertNotIn("outputs", changed["changes"])
        self.assertNotIn("run", changed)
        second_events = await anext(stream)
        self.assertIn("id: 2\n", second_events)
        self.assertEqual([event["seq"] for event in payload(second_events)["events"]], [2])
        self.assertEqual(await anext(stream), ": heartbeat\n\n")
        # An unchanged idle loop sends no repeated snapshot or state JSON.
        self.assertEqual(await anext(stream), ": heartbeat\n\n")
        self.request.closed = True
        with self.assertRaises(StopAsyncIteration):
            await anext(stream)

    async def test_reconnect_drains_all_event_batches_after_cursor(self):
        for index in range(550):
            self.store.event(self.run["id"], message=f"event {index}")
        stream = research_events(self.store, self.run["id"], self.request,
                                 after_seq=1, interval=0, heartbeat=0)
        await anext(stream)
        await anext(stream)
        batches = [payload(await anext(stream)) for _ in range(3)]
        self.assertEqual([len(batch["events"]) for batch in batches], [250, 250, 50])
        sequences = [event["seq"] for batch in batches for event in batch["events"]]
        self.assertEqual(sequences, list(range(2, 552)))
        self.assertEqual(batches[-1]["last_seq"], 551)
        await stream.aclose()

    async def test_disconnect_and_cancellation_release_the_generator(self):
        stream = research_events(self.store, self.run["id"], self.request, interval=60)
        await anext(stream)
        await anext(stream)
        await anext(stream)
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)
        pending.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertIsNone(stream.ag_frame)
        self.request.closed = True
        disconnected = research_events(self.store, self.run["id"], self.request)
        await anext(disconnected)  # SSE retry directive carries no run state.
        with self.assertRaises(StopAsyncIteration):
            await anext(disconnected)

    async def test_route_sets_stream_headers_and_replays_native_last_event_id(self):
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(research=SimpleNamespace(store=self.store))),
                                  headers={"last-event-id": "1"}, is_disconnected=self.request.is_disconnected)
        response = await subscribe_run(self.run["id"], request, after_seq=0)
        self.assertEqual(response.media_type, "text/event-stream")
        self.assertEqual(response.headers["cache-control"], "no-cache, no-transform")
        self.assertEqual(response.headers["x-accel-buffering"], "no")
        stream = response.body_iterator
        await anext(stream)
        self.assertEqual(payload(await anext(stream))["run"]["id"], self.run["id"])
        # Cursor 1 omits the only journal event; a fresh snapshot is still sent.
        self.request.closed = True
        with self.assertRaises(StopAsyncIteration):
            await anext(stream)


class ResearchStreamRouteTests(unittest.TestCase):
    def test_invalid_cursor_and_unknown_run_fail_before_stream_headers(self):
        class MissingStore:
            def get(self, _run_id):
                raise KeyError("unknown")
        app = FastAPI()
        app.state.research = SimpleNamespace(store=MissingStore())
        app.include_router(router)
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/research/runs/missing/stream").status_code, 404)
            self.assertEqual(client.get("/api/research/runs/missing/stream?after_seq=-1").status_code, 422)
            self.assertEqual(client.get(f"/api/research/runs/missing/stream?after_seq={2**63}").status_code, 422)

    def test_last_event_id_is_optional_bounded_and_never_moves_cursor_backward(self):
        for raw, expected in [(None, 4), ("bad", 4), ("-10", 4), ("3", 4), ("9", 9), (str(2**63), 4)]:
            self.assertEqual(reconnect_cursor(4, raw), expected)
