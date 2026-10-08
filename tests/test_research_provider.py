"""Model transport, evidence and budget tests without network or production DBs."""
import asyncio
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx

from src.research.contracts import Budget, ResearchBudgetExceeded, ResearchCancelled, ResearchQuestion, RunRequest
from src.research.provider import ResearchProvider
from src.research.store import ResearchStore


_ASYNC_CLIENT = httpx.AsyncClient
_VALID_CONTENT = json.dumps({
    "title": "Digits robustness", "hypothesis": "Noise changes classification error",
    "motivation": "Compare measured matched controls", "research_query": "digits noise robustness",
})
_CONFIG = {"provider": "ollama", "model": "test-local-model", "api_key": "",
           "base_url": "http://provider.invalid/v1", "trust_env": False}


class ResearchProviderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = ResearchStore(Path(self.temporary.name))
        with patch("src.research.provider._get_provider_config", return_value=_CONFIG.copy()):
            self.provider = ResearchProvider(self.store)

    def tearDown(self):
        self.store.close()
        self.temporary.cleanup()

    def run(self, result=None):
        # unittest.TestCase.run is kept unchanged; research runs are named new_run.
        return super().run(result)

    def new_run(self, model_calls=2):
        return self.store.create(RunRequest(
            goal="Test deterministic provider failure recovery", request_id="provider-test-01",
            budget=Budget(model_calls=model_calls),
        ))[0]

    def transport(self, handler):
        return patch("src.research.provider.httpx.AsyncClient", side_effect=lambda **options:
            _ASYNC_CLIENT(transport=httpx.MockTransport(handler), **options))

    def logs(self, run_id):
        directory = self.store.run_dir(run_id) / "model"
        return [json.loads(file.read_text(encoding="utf-8")) for file in sorted(directory.glob("*.json"))]

    async def ask(self, run, *, deadline=None, cancelled=lambda: False, role="ideation"):
        return await self.provider.ask(run["id"], role, "A bounded research prompt", ResearchQuestion,
                                       time.monotonic() + 5 if deadline is None else deadline, cancelled)

    async def test_failed_raw_response_and_success_are_both_saved_with_actual_budget(self):
        run = self.new_run()
        requests = []

        async def handler(request):
            requests.append(json.loads(request.content))
            content = "{broken json" if len(requests) == 1 else _VALID_CONTENT
            return httpx.Response(200, json={"choices": [{"message": {"content": content}}],
                                            "usage": {"prompt_tokens": 11, "completion_tokens": 4, "total_tokens": 15}}, request=request)

        with self.transport(handler):
            answer = await self.ask(run)
        self.assertEqual(answer["title"], "Digits robustness")
        records = self.logs(run["id"])
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["response"], "{broken json")
        self.assertFalse(records[0]["validated"])
        self.assertEqual(records[0]["error"]["type"], "ValidationError")
        self.assertTrue(records[1]["validated"])
        self.assertIsNone(records[1]["error"])
        self.assertEqual(records[1]["usage"]["total_tokens"], 15)
        self.assertEqual([record["model_call_number"] for record in records], [1, 2])
        saved = self.store.get(run["id"])
        self.assertEqual(saved["budget"]["used_model_calls"], 2)
        self.assertEqual(saved["automatic_recoveries"], 1)
        self.assertIn("Previous response failed validation", requests[1]["messages"][1]["content"])

    async def test_two_invalid_responses_keep_failure_evidence_and_stop(self):
        run = self.new_run()

        async def handler(request):
            return httpx.Response(200, json={"choices": [{"message": {"content": "invalid response"}}]}, request=request)

        with self.transport(handler), self.assertRaises(ValueError):
            await self.ask(run)
        records = self.logs(run["id"])
        self.assertEqual(len(records), 2)
        self.assertTrue(all(not record["validated"] and record["error"] for record in records))
        self.assertEqual(self.store.get(run["id"])["budget"]["used_model_calls"], 2)
        self.assertFalse(any(event["type"] == "model_end" for event in self.store.events(run["id"])["events"]))

    async def test_default_model_calls_continue_past_old_limit_and_still_record_usage(self):
        run = self.new_run(model_calls=None)
        async def handler(request):
            return httpx.Response(200, json={"choices": [{"message": {"content": _VALID_CONTENT}}]}, request=request)
        with self.transport(handler):
            for _ in range(13):
                await self.ask(run)
        saved = self.store.get(run["id"])
        self.assertIsNone(saved["budget"]["model_calls"])
        self.assertEqual(saved["budget"]["used_model_calls"], 13)
        self.assertEqual(len(self.logs(run["id"])), 13)

    async def test_exhausted_retry_budget_does_not_claim_a_recovery_that_never_started(self):
        run = self.new_run(model_calls=1)
        requests = []

        async def handler(request):
            requests.append(request)
            return httpx.Response(200, json={"choices": [{"message": {"content": "invalid response"}}]}, request=request)

        with self.transport(handler), self.assertRaises(ResearchBudgetExceeded):
            await self.ask(run)
        saved = self.store.get(run["id"])
        self.assertEqual(len(requests), 1)
        self.assertEqual(saved["budget"]["used_model_calls"], 1)
        self.assertEqual(saved["automatic_recoveries"], 0)
        self.assertEqual(len(self.logs(run["id"])), 1)

    async def test_zero_model_budget_never_sends_a_request(self):
        run = self.new_run(model_calls=0)
        with patch("src.research.provider.httpx.AsyncClient") as client, self.assertRaises(ResearchBudgetExceeded):
            await self.ask(run)
        client.assert_not_called()
        self.assertEqual(self.store.get(run["id"])["budget"]["used_model_calls"], 0)

    async def test_cancellation_awaits_pending_transport_and_never_reports_success(self):
        run = self.new_run()
        checks = 0
        cleaned_up = False

        async def handler(request):
            nonlocal cleaned_up
            try:
                await asyncio.Event().wait()
            finally:
                cleaned_up = True

        def cancelled():
            nonlocal checks
            checks += 1
            return checks >= 3

        with self.transport(handler), self.assertRaises(ResearchCancelled):
            await self.ask(run, cancelled=cancelled)
        self.assertTrue(cleaned_up)
        records = self.logs(run["id"])
        self.assertEqual(records[0]["status"], "cancelled")
        self.assertFalse(records[0]["validated"])
        self.assertEqual(self.store.get(run["id"])["budget"]["used_model_calls"], 1)
        self.assertFalse(any(event["type"] == "model_end" for event in self.store.events(run["id"])["events"]))

    async def test_cancellation_when_reply_completes_still_prevents_success(self):
        run = self.new_run()
        cancellation_requested = False

        async def handler(request):
            nonlocal cancellation_requested
            cancellation_requested = True
            return httpx.Response(200, json={"choices": [{"message": {"content": _VALID_CONTENT}}]}, request=request)

        with self.transport(handler), self.assertRaises(ResearchCancelled):
            await self.ask(run, cancelled=lambda: cancellation_requested)
        self.assertEqual(self.logs(run["id"])[0]["status"], "cancelled")
        self.assertFalse(any(event["type"] == "model_end" for event in self.store.events(run["id"])["events"]))

    async def test_global_deadline_is_not_extended_by_request_preparation(self):
        run = self.new_run()
        transport_started = False
        ticks = iter([100.0, 100.2, 100.6])

        def monotonic():
            return next(ticks, 100.8)

        async def handler(request):
            nonlocal transport_started
            transport_started = True
            await asyncio.Event().wait()

        # Patch only this module's clock, preserving the event loop's real clock.
        with patch("src.research.provider.time", SimpleNamespace(monotonic=monotonic)), \
             self.transport(handler), self.assertRaises(ResearchBudgetExceeded):
            await self.ask(run, deadline=100.5)
        self.assertFalse(transport_started)
        self.assertEqual(self.store.get(run["id"])["budget"]["used_model_calls"], 1)
        self.assertEqual(self.store.get(run["id"])["automatic_recoveries"], 0)
        self.assertEqual(len(self.logs(run["id"])), 1)

    async def test_oversized_invalid_response_is_logged_with_explicit_truncation(self):
        run = self.new_run(model_calls=1)

        async def handler(request):
            return httpx.Response(200, json={"choices": [{"message": {"content": "x" * 31000}}]}, request=request)

        with self.transport(handler), self.assertRaises(ResearchBudgetExceeded):
            await self.ask(run)
        record = self.logs(run["id"])[0]
        self.assertFalse(record["validated"])
        self.assertTrue(record["response_truncated"])
        self.assertEqual(record["response_chars"], 31000)
        self.assertEqual(len(record["response"]), 30000)

    async def test_malformed_model_lists_return_health_error_without_crashing(self):
        for body in (None, {}, {"data": None}, {"data": {}}, {"data": ["model"]}, {"data": [None]}, {"data": [{"id": 123}]}):
            with self.subTest(body=body):
                async def handler(request):
                    return httpx.Response(200, json=body, request=request)

                with self.transport(handler):
                    result = await self.provider.health()
                self.assertFalse(result["available"])
                self.assertTrue(result["error"])

    async def test_health_distinguishes_configured_model_from_missing_model(self):
        for models, available in ([{"id": _CONFIG["model"]}], True), ([], False), ([{"id": "another-model"}], False):
            with self.subTest(models=models):
                async def handler(request):
                    return httpx.Response(200, json={"data": models}, request=request)

                with self.transport(handler):
                    status = await self.provider.health()
                self.assertEqual(status["available"], available)
                self.assertEqual(bool(status["error"]), not available)

    async def test_health_http_failure_is_graceful(self):
        async def handler(request):
            raise httpx.ConnectError("offline", request=request)

        with self.transport(handler):
            result = await self.provider.health()
        self.assertFalse(result["available"])
        self.assertIn("不可达", result["error"])


if __name__ == "__main__":
    unittest.main()
