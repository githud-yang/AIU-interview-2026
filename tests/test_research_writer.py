"""Writer routing, Responses parsing and bounded CLI transport regression tests."""
import asyncio
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from src.research.contracts import ResearchAnalysis, ResearchCancelled, RunRequest
from src.research.provider import ResearchProvider
from src.research.store import ResearchStore
from src.research.writer import WriterRouter, strict_schema

CLIENT = httpx.AsyncClient
VALID = {"interpretation": "The small benchmark shows a measured trade-off.", "limitations": ["Novelty unverified"], "follow_up": []}


class WriterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = ResearchStore(Path(self.tmp.name))
        self.run, _ = self.store.create(RunRequest(goal="Test a bounded scientific writing integration", request_id="writer-test-01"))

    async def asyncTearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def router(self):
        with patch.dict(os.environ, {"RESEARCH_WRITER_PROVIDER": "codex"}, clear=True), patch("shutil.which", return_value="codex.exe"):
            return WriterRouter(self.store)

    async def test_auto_routing_prefers_configured_cloud_but_reuses_existing_codex_without_keys(self):
        with patch.dict(os.environ, {}, clear=True), patch("shutil.which", return_value="codex.exe"):
            self.assertEqual(WriterRouter(self.store).provider, "codex")
            with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "fixture-key"}):
                configured = WriterRouter(self.store)
                self.assertEqual(configured.provider, "deepseek")
                self.assertEqual(configured.config["model"], "deepseek-flash")
            with patch.dict(os.environ, {"OPENAI_API_KEY": "fixture-key", "OPENAI_MODEL": "test-model"}):
                self.assertEqual(WriterRouter(self.store).provider, "openai")

    async def test_openai_responses_collects_message_text_after_reasoning_and_sends_strict_schema(self):
        provider = ResearchProvider(self.store, writer_enabled=False)
        provider.config = {"provider": "openai", "model": "test-api-model", "api_key": "fixture-key", "base_url": "https://api.invalid/v1", "trust_env": False}
        captured = []
        async def handle(request):
            captured.append(request)
            return httpx.Response(200, json={"status": "completed", "output": [
                {"type": "reasoning", "content": []}, {"type": "message", "content": [
                    {"type": "output_text", "text": json.dumps(VALID)}]}], "usage": {"input_tokens": 7, "output_tokens": 9}})
        with patch("src.research.provider.httpx.AsyncClient", side_effect=lambda **kw: CLIENT(transport=httpx.MockTransport(handle), **kw)):
            result = await provider.ask(self.run["id"], "analysis", "Actual facts", ResearchAnalysis, time.monotonic()+5, lambda: False)
        self.assertEqual(result, VALID)
        self.assertEqual(captured[0].url.path, "/v1/responses")
        body = json.loads(captured[0].content)
        self.assertTrue(body["text"]["format"]["strict"])
        self.assertFalse(body["store"])
        self.assertNotIn("temperature", body)
        self.assertEqual(set(body["text"]["format"]["schema"]["required"]), set(VALID))
        attempt = json.loads(next((self.store.run_dir(self.run["id"]) / "model").glob("*.json")).read_text())
        self.assertEqual(attempt["usage"], {"input_tokens": 7, "output_tokens": 9})

    async def test_incomplete_response_with_parseable_json_is_not_a_success(self):
        provider = ResearchProvider(self.store, writer_enabled=False)
        provider.config = {"provider": "openai", "model": "test-api-model", "api_key": "fixture-key", "base_url": "https://api.invalid/v1", "trust_env": False}
        async def handle(request):
            return httpx.Response(200, json={"status": "incomplete", "output": [
                {"type": "message", "content": [{"type": "output_text", "text": json.dumps(VALID)}]}]})
        with patch("src.research.provider.httpx.AsyncClient", side_effect=lambda **kw: CLIENT(transport=httpx.MockTransport(handle), **kw)):
            with self.assertRaisesRegex(ValueError, "未完成"):
                await provider.ask(self.run["id"], "analysis", "Actual facts", ResearchAnalysis, time.monotonic()+5, lambda: False)
        self.assertFalse(any(e["type"] == "model_end" for e in self.store.events(self.run["id"])["events"]))

    async def test_nested_api_schema_makes_defaulted_properties_required_without_changing_local_validation(self):
        from src.research.domain import ResearchRecipe
        converted = strict_schema(ResearchRecipe.model_json_schema())
        self.assertEqual(set(converted["required"]), set(converted["properties"]))
        self.assertNotIn("default", converted["properties"]["dataset"])
        self.assertFalse(converted["$defs"]["ModelRecipe"]["additionalProperties"])
        self.assertEqual(ResearchRecipe().seeds, [13, 37, 73])

    async def test_deepseek_paper_role_uses_configured_key_model_json_and_thinking_allowance(self):
        with patch.dict(os.environ, {"RESEARCH_WRITER_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "sk-fixture-paper-key",
                                    "RESEARCH_WRITER_MODEL": "deepseek-flash"}, clear=True):
            provider = ResearchProvider(self.store)
        requests = []
        async def handle(request):
            requests.append(request)
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {
                "content": json.dumps(VALID), "reasoning_content": "not retained as paper text"}}],
                "usage": {"prompt_tokens": 20, "completion_tokens": 40, "total_tokens": 60}})
        with patch("src.research.provider.httpx.AsyncClient", side_effect=lambda **kw: CLIENT(transport=httpx.MockTransport(handle), **kw)):
            answer = await provider.ask(self.run["id"], "analysis", "Only these measured facts", ResearchAnalysis, float("inf"), lambda: False)
        self.assertEqual(answer, VALID)
        self.assertEqual(str(requests[0].url), "https://api.deepseek.com/v1/chat/completions")
        self.assertEqual(requests[0].headers["authorization"], "Bearer sk-fixture-paper-key")
        payload = json.loads(requests[0].content)
        self.assertEqual(payload["model"], "deepseek-flash")
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["thinking"], {"type": "enabled"})
        self.assertEqual(payload["max_tokens"], 8192)
        self.assertIn("JSON", payload["messages"][0]["content"])
        self.assertEqual(self.store.get(self.run["id"])["budget"]["used_model_calls"], 1)
        log = next((self.store.run_dir(self.run["id"]) / "model").glob("*.json")).read_text()
        self.assertNotIn("sk-fixture-paper-key", log)
        self.assertNotIn("reasoning_content", log)

    async def test_codex_success_uses_owned_schema_readonly_flags_and_actual_call_budget(self):
        router = self.router()
        seen = []
        class Process:
            returncode = 0
            async def communicate(self, content):
                self.input = content
                return b'{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":9}}\n', b""
        async def launch(*argv, **kwargs):
            seen.extend(argv)
            Path(argv[argv.index("--output-last-message")+1]).write_text(json.dumps(VALID), encoding="utf-8")
            return Process()
        with patch("src.research.writer.asyncio.create_subprocess_exec", side_effect=launch):
            result = await router._codex(self.run["id"], "analysis", "Measured evidence only", ResearchAnalysis, time.monotonic()+5, lambda: False)
        self.assertEqual(result, VALID)
        self.assertIn("--ignore-user-config", seen)
        self.assertIn("read-only", seen)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", seen)
        self.assertEqual(self.store.get(self.run["id"])["budget"]["used_model_calls"], 1)
        attempt = json.loads(next(self.store.run_dir(self.run["id"]).rglob("attempt.json")).read_text())
        self.assertTrue(attempt["validated"])
        self.assertEqual(attempt["usage"]["output_tokens"], 9)

    async def test_failed_cli_is_recorded_and_local_fallback_is_reused_without_repeating_failed_writer(self):
        router = self.router()
        controller = AsyncMock()
        controller.ask.return_value = VALID
        class Process:
            returncode = 1
            async def communicate(self, content):
                return b'{"type":"error","message":"quota unavailable"}\n', b"quota unavailable"
        with patch("src.research.writer.asyncio.create_subprocess_exec", new=AsyncMock(return_value=Process())) as launch:
            for role in ("analysis", "review"):
                self.assertEqual(await router.ask(controller, self.run["id"], role, "facts", ResearchAnalysis, time.monotonic()+5, lambda: False), VALID)
        self.assertEqual(launch.await_count, 1)
        self.assertEqual(controller.ask.await_count, 2)
        self.assertTrue(controller.ask.call_args.kwargs["_force_default"])
        attempt = json.loads(next(self.store.run_dir(self.run["id"]).rglob("attempt.json")).read_text())
        self.assertEqual(attempt["status"], "failed")
        self.assertEqual(self.store.get(self.run["id"])["model_mode"], "mixed_with_recorded_fallback")

    async def test_cancel_terminates_cli_and_awaits_transport_cleanup(self):
        router = self.router()
        started, stopped = asyncio.Event(), asyncio.Event()
        cancel = [False]
        class Process:
            returncode = None
            async def communicate(self, content):
                started.set()
                await stopped.wait()
                return b"", b""
            def terminate(self):
                self.returncode = -15
                stopped.set()
        with patch("src.research.writer.asyncio.create_subprocess_exec", new=AsyncMock(return_value=Process())):
            task = asyncio.create_task(router._codex(self.run["id"], "analysis", "facts", ResearchAnalysis, time.monotonic()+5, lambda: cancel[0]))
            await asyncio.wait_for(started.wait(), 1)
            cancel[0] = True
            with self.assertRaises(ResearchCancelled):
                await asyncio.wait_for(task, 2)
        self.assertTrue(stopped.is_set())
        self.assertFalse(any(e["type"] == "model_end" for e in self.store.events(self.run["id"])["events"]))


if __name__ == "__main__":
    unittest.main()
