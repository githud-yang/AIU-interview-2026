"""Offline integration checks: real SQLite/checkpoints, bounded mocked I/O.

Model HTTP is intercepted by httpx.MockTransport. Expensive stage tools are
replaced by tiny deterministic outputs; graph/state/operation logic stays real.
"""
from __future__ import annotations

import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from src.research.contracts import Budget, ResearchCancelled, ResearchQuestion, RunRequest
from src.research.provider import ResearchProvider
from src.research.store import ResearchStore


class ResearchProviderIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.store = ResearchStore(self.root)
        self.run, _ = self.store.create(RunRequest(
            goal="Compare digits models using fixed matched controls",
            request_id="provider-test-0001", budget=Budget(model_calls=4),
        ))
        self.provider = ResearchProvider(self.store)

    async def asyncTearDown(self):
        self.store.close()
        self.temporary.cleanup()

    def transport_patch(self, handler):
        client_type = httpx.AsyncClient
        transport = httpx.MockTransport(handler)
        return patch("src.research.provider.httpx.AsyncClient", side_effect=lambda **kwargs: client_type(
            **{**kwargs, "transport": transport}
        ))

    async def test_cancel_pending_model_http_aborts_request_and_does_not_record_success(self):
        started = asyncio.Event()
        request_cancelled = asyncio.Event()

        async def handler(_request):
            started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                request_cancelled.set()
                raise

        with self.transport_patch(handler):
            work = asyncio.create_task(self.provider.ask(
                self.run["id"], "ideation", "Return a research question", ResearchQuestion,
                time.monotonic() + 5, lambda: self.store.get(self.run["id"])["cancel_requested"],
            ))
            await asyncio.wait_for(started.wait(), 1)
            self.store.update(self.run["id"], {"cancel_requested": True})
            with self.assertRaises(ResearchCancelled):
                await asyncio.wait_for(work, 2)
        self.assertTrue(request_cancelled.is_set())
        saved = self.store.get(self.run["id"])
        self.assertEqual(saved["budget"]["used_model_calls"], 1)
        events = self.store.events(self.run["id"])["events"]
        self.assertFalse(any(event["type"] == "model_end" for event in events))
        self.assertIsNone(self.store.operation(self.run["id"], "ideation"))

    async def test_invalid_model_json_is_repaired_once_and_both_calls_consume_budget(self):
        responses = iter(["not valid JSON", json.dumps({
            "title": "A controlled noise comparison", "hypothesis": "Compare fixed noise settings",
            "motivation": "A small reproducible workflow check", "research_query": "digits robustness",
            "novelty_status": "unverified", "limitations": ["Innovation not established"],
        })])

        async def handler(_request):
            return httpx.Response(200, json={"choices": [{"message": {"content": next(responses)}}]})

        with self.transport_patch(handler):
            output = await self.provider.ask(
                self.run["id"], "ideation", "Return a research question", ResearchQuestion,
                time.monotonic() + 5, lambda: False,
            )
        self.assertEqual(output["novelty_status"], "unverified")
        saved = self.store.get(self.run["id"])
        self.assertEqual(saved["budget"]["used_model_calls"], 2)
        self.assertEqual(saved["automatic_recoveries"], 1)
        events = self.store.events(self.run["id"])["events"]
        self.assertEqual(sum(event["type"] == "model_error" for event in events), 1)
        self.assertEqual(sum(event["type"] == "model_end" for event in events), 1)
        logs = list((self.store.run_dir(self.run["id"]) / "model").glob("*.json"))
        self.assertEqual(len(logs), 2)
        parsed = [json.loads(path.read_text(encoding="utf-8")) for path in sorted(logs)]
        self.assertFalse(parsed[0]["validated"])
        self.assertTrue(parsed[1]["validated"])


if __name__ == "__main__":
    unittest.main()
