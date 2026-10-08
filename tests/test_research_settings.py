"""DeepSeek credential settings are local, private and transactional; no live API."""
import asyncio
import json
import logging
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.research.settings import DeepSeekSettings
from src.web.routes.research_routes import router


_ASYNC_CLIENT = httpx.AsyncClient
_KEY = "sk-fixture-only-do-not-use-1234567890"
_OLD_KEY = "sk-fixture-old-do-not-use-0987654321"
_OTHER_KEY = "sk-unrelated-fixture-only-1122334455"
_MODEL = "deepseek-flash"
_ENDPOINT = "/api/research/writer-settings"


class FakeStore:
    def __init__(self):
        self.runs = []

    def list_runs(self):
        return self.runs


class FakeService:
    def __init__(self):
        self.store = FakeStore()
        self.provider = SimpleNamespace(writer=SimpleNamespace(provider="codex", config=None))
        self.exporting = False
        self.configuring = False
        self.closing = False
        self.settings_done = asyncio.Event()
        self.settings_done.set()


class LogCollector(logging.Handler):
    def __init__(self):
        super().__init__()
        self.messages = []

    def emit(self, record):
        self.messages.append(self.format(record))


class ResearchWriterSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.env_path = Path(self.temporary.name) / ".env"
        self.original = ("# Preserve controller and unrelated credentials\n"
                         "LLM_PROVIDER=ollama\nOLLAMA_MODEL=qwen2.5:7b\n"
                         "DEEPSEEK_MODEL=controller-model\n"
                         f'OPENAI_API_KEY="{_OTHER_KEY}"\n'
                         "UNRELATED_VALUE=contains=equals\n"
                         "RESEARCH_WRITER_PROVIDER=codex\n").encode()
        self.env_path.write_bytes(self.original)
        self.environment = patch.dict(os.environ, {"LLM_PROVIDER": "ollama", "DEEPSEEK_MODEL": "controller-model"}, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(self.temporary.cleanup)
        self.service = FakeService()
        self.settings = DeepSeekSettings(self.env_path, self.service)
        self.service.writer_settings = self.settings
        self.app = FastAPI()
        self.app.state.research = self.service
        self.app.include_router(router)
        self.client = TestClient(self.app, base_url="http://127.0.0.1:8000")
        self.addCleanup(self.client.close)
        self.logs = LogCollector()
        logging.getLogger().addHandler(self.logs)
        self.addCleanup(logging.getLogger().removeHandler, self.logs)

    def transport(self, handler):
        return patch("src.research.settings.httpx.AsyncClient", side_effect=lambda **options:
                     _ASYNC_CLIENT(transport=httpx.MockTransport(handler), **options))

    def payload(self, api_key=_KEY, model=_MODEL):
        return {"api_key": api_key, "model": model}

    def assert_private(self, response):
        for secret in (_KEY, _OLD_KEY, _OTHER_KEY):
            self.assertNotIn(secret, response.text)
            self.assertNotIn(secret, "\n".join(self.logs.messages))

    def assert_unchanged(self, environment, writer):
        self.assertEqual(self.env_path.read_bytes(), self.original)
        self.assertEqual(dict(os.environ), environment)
        self.assertIs(self.service.provider.writer, writer)
        self.assertFalse(self.service.configuring)

    def success(self, request):
        self.assertEqual(str(request.url), "https://api.deepseek.com/v1/models")
        self.assertEqual(request.method, "GET")
        self.assertEqual(request.headers["authorization"], "Bearer " + _KEY)
        return httpx.Response(200, json={"object": "list", "data": [{"id": _MODEL}]}, request=request)

    def test_get_returns_configuration_without_secret(self):
        os.environ.update({"DEEPSEEK_API_KEY": _KEY, "RESEARCH_WRITER_PROVIDER": "deepseek", "RESEARCH_WRITER_MODEL": _MODEL})
        self.service.provider.writer = SimpleNamespace(provider="deepseek", config={"model": _MODEL, "api_key": _KEY})
        response = self.client.get(_ENDPOINT)
        self.assertEqual(response.status_code, 200)
        value = response.json()
        self.assertTrue(value["key_configured"])
        self.assertEqual(value["model"], _MODEL)
        self.assertTrue(value["editable"])
        self.assertFalse(value["busy"])
        self.assertNotIn("api_key", value)
        self.assert_private(response)

    def test_connection_test_is_read_only_and_uses_fixed_https_origin(self):
        environment, writer = dict(os.environ), self.service.provider.writer
        with self.transport(self.success):
            response = self.client.post(_ENDPOINT + "/test", json=self.payload())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assert_unchanged(environment, writer)
        self.assert_private(response)

    def test_http_and_transport_failures_remain_private_and_do_not_persist(self):
        for failure in (302, 401, 429, 503, "connect", "timeout"):
            with self.subTest(failure=failure):
                environment, writer = dict(os.environ), self.service.provider.writer

                def handler(request):
                    if failure == "connect":
                        raise httpx.ConnectError("raw-provider-body " + _KEY, request=request)
                    if failure == "timeout":
                        raise httpx.ReadTimeout("raw-provider-body " + _KEY, request=request)
                    return httpx.Response(failure, text="raw-provider-body " + _KEY,
                                          headers={"Location": "https://attacker.invalid/key-sink"}, request=request)

                with self.transport(handler):
                    response = self.client.post(_ENDPOINT + "/test", json=self.payload())
                self.assertFalse(response.status_code == 200 and response.json().get("ok"))
                self.assertNotIn("raw-provider-body", response.text)
                self.assert_private(response)
                self.assert_unchanged(environment, writer)

    def test_model_lists_must_be_well_formed_and_include_selected_model(self):
        for body in ({}, {"data": None}, {"data": {}}, {"data": [None]}, {"data": ["model"]},
                     {"data": [{"id": 123}]}, {"data": []}, {"data": [{"id": "another-model"}]}):
            with self.subTest(body=body):
                def handler(request):
                    return httpx.Response(200, json=body, request=request)
                with self.transport(handler):
                    response = self.client.post(_ENDPOINT + "/test", json=self.payload())
                self.assertFalse(response.status_code == 200 and response.json().get("ok"))
                self.assert_private(response)
                self.assertEqual(self.env_path.read_bytes(), self.original)

    def test_successful_save_preserves_other_configuration_and_switches_only_writer(self):
        self.original += f'DEEPSEEK_API_KEY="{_OLD_KEY}"\nDEEPSEEK_API_KEY={_OLD_KEY}\n'.encode()
        self.env_path.write_bytes(self.original)
        writer = self.service.provider.writer
        with self.transport(self.success):
            response = self.client.put(_ENDPOINT, json=self.payload())
        self.assertEqual(response.status_code, 200)
        self.assert_private(response)
        saved = self.env_path.read_text(encoding="utf-8")
        for line in ("# Preserve controller and unrelated credentials", "LLM_PROVIDER=ollama", "OLLAMA_MODEL=qwen2.5:7b",
                     "DEEPSEEK_MODEL=controller-model", f'OPENAI_API_KEY="{_OTHER_KEY}"', "UNRELATED_VALUE=contains=equals"):
            self.assertIn(line, saved)
        self.assertNotIn(_OLD_KEY, saved)
        self.assertEqual(sum(line.startswith("DEEPSEEK_API_KEY=") for line in saved.splitlines()), 1)
        self.assertEqual(os.environ["DEEPSEEK_API_KEY"], _KEY)
        self.assertEqual(os.environ["DEEPSEEK_BASE_URL"], "https://api.deepseek.com/v1")
        self.assertEqual(os.environ["RESEARCH_WRITER_PROVIDER"], "deepseek")
        self.assertEqual(os.environ["RESEARCH_WRITER_MODEL"], _MODEL)
        self.assertEqual(os.environ["LLM_PROVIDER"], "ollama")
        self.assertEqual(os.environ["DEEPSEEK_MODEL"], "controller-model")
        self.assertIsNot(self.service.provider.writer, writer)
        self.assertEqual(self.service.provider.writer.provider, "deepseek")
        self.assertEqual(self.service.provider.writer.config["api_key"], _KEY)
        self.assertFalse(self.service.configuring)

    def test_failed_save_retains_file_environment_and_writer(self):
        environment, writer = dict(os.environ), self.service.provider.writer
        def handler(request):
            return httpx.Response(401, text="provider-internal-secret " + _KEY, request=request)
        with self.transport(handler):
            response = self.client.put(_ENDPOINT, json=self.payload())
        self.assertGreaterEqual(response.status_code, 400)
        self.assert_unchanged(environment, writer)
        self.assert_private(response)
        self.assertNotIn("provider-internal-secret", response.text)

    def test_atomic_write_failure_does_not_activate_unsaved_key(self):
        environment, writer = dict(os.environ), self.service.provider.writer
        with self.transport(self.success), patch("src.research.settings.Path.replace", side_effect=OSError("disk failed " + _KEY)):
            response = self.client.put(_ENDPOINT, json=self.payload())
        self.assertGreaterEqual(response.status_code, 400)
        self.assert_unchanged(environment, writer)
        self.assert_private(response)

    def test_blank_or_null_key_reuses_configured_key(self):
        os.environ["DEEPSEEK_API_KEY"] = _KEY
        for value in ("", None):
            with self.subTest(value=value), self.transport(self.success):
                response = self.client.post(_ENDPOINT + "/test", json=self.payload(api_key=value))
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.json()["ok"])
                self.assert_private(response)
        self.assertEqual(self.env_path.read_bytes(), self.original)

    def test_missing_model_uses_default_and_missing_key_never_sends_authorization(self):
        with self.transport(self.success):
            response = self.client.post(_ENDPOINT + "/test", json={"api_key": _KEY})
        self.assertEqual(response.status_code, 200)
        for key in ("", None):
            with self.subTest(key=key), patch("src.research.settings.httpx.AsyncClient") as client:
                response = self.client.post(_ENDPOINT + "/test", json=self.payload(api_key=key))
                self.assertGreaterEqual(response.status_code, 400)
                client.assert_not_called()
                self.assert_private(response)

    def test_becoming_busy_during_connection_check_prevents_save(self):
        environment, writer = dict(os.environ), self.service.provider.writer

        def handler(request):
            self.service.store.runs = [{"status": "running"}]
            return self.success(request)

        with self.transport(handler):
            response = self.client.put(_ENDPOINT, json=self.payload())
        self.assertIn(response.status_code, {403, 409})
        self.assert_unchanged(environment, writer)
        self.assert_private(response)

    def test_save_is_rejected_while_work_is_active(self):
        for state in ("queued", "running", "cancelling", "exporting", "configuring", "closing"):
            with self.subTest(state=state):
                self.service.store.runs = [{"status": state}] if state in {"queued", "running", "cancelling"} else []
                self.service.exporting = state == "exporting"
                self.service.configuring = state == "configuring"
                self.service.closing = state == "closing"
                environment, writer = dict(os.environ), self.service.provider.writer
                status = self.client.get(_ENDPOINT)
                self.assertTrue(status.json()["busy"])
                self.assertFalse(status.json()["editable"])
                with patch("src.research.settings.httpx.AsyncClient") as client:
                    response = self.client.put(_ENDPOINT, json=self.payload())
                self.assertIn(response.status_code, {403, 409})
                client.assert_not_called()
                self.assertEqual(self.env_path.read_bytes(), self.original)
                self.assertEqual(dict(os.environ), environment)
                self.assertIs(self.service.provider.writer, writer)
                self.assert_private(response)
        self.service.store.runs = []
        self.service.exporting = self.service.configuring = self.service.closing = False

    def test_cross_site_or_wrong_content_type_cannot_test_or_save_credentials(self):
        bad_headers = ({"Origin": "https://attacker.invalid"}, {"Origin": "http://127.0.0.1:9999"},
                       {"Origin": "http://127.0.0.1:8000.attacker.invalid"}, {"Origin": "null"},
                       {"Origin": "http://127.0.0.1:invalid-port"},
                       {"Sec-Fetch-Site": "cross-site"}, {"Content-Type": "text/plain"})
        for endpoint, method in ((_ENDPOINT + "/test", "post"), (_ENDPOINT, "put")):
            for headers in bad_headers:
                with self.subTest(endpoint=endpoint, headers=headers), patch("src.research.settings.httpx.AsyncClient") as client:
                    response = getattr(self.client, method)(endpoint, json=self.payload(), headers=headers)
                    self.assertIn(response.status_code, {403, 415})
                    client.assert_not_called()
                    self.assert_private(response)
                    self.assertEqual(self.env_path.read_bytes(), self.original)

    def test_same_origin_is_allowed_and_missing_content_type_is_rejected(self):
        with self.transport(self.success):
            response = self.client.post(_ENDPOINT + "/test", json=self.payload(), headers={"Origin": "http://127.0.0.1:8000", "Sec-Fetch-Site": "same-origin"})
        self.assertEqual(response.status_code, 200)
        with patch("src.research.settings.httpx.AsyncClient") as client:
            response = self.client.post(_ENDPOINT + "/test", content=json.dumps(self.payload()))
            self.assertEqual(response.status_code, 415)
            client.assert_not_called()

    def test_invalid_body_never_echoes_input_or_sends_key(self):
        values = [self.payload(api_key="short"), self.payload(api_key=_KEY + " " + _KEY),
                  self.payload(api_key=_KEY + "'"), self.payload(api_key=_KEY + '"'),
                  self.payload(api_key=_KEY + "#"), self.payload(api_key=_KEY + "\n"),
                  self.payload(api_key="密钥" + _KEY), self.payload(api_key=_KEY * 20),
                  self.payload(model="bad model " + _KEY), self.payload(model="a" * 101),
                  {"api_key": _KEY, "model": _MODEL, "base_url": "https://attacker.invalid"},
                  {"api_key": [_KEY], "model": _MODEL}, [_KEY]]
        for body in values:
            with self.subTest(body_type=type(body).__name__), patch("src.research.settings.httpx.AsyncClient") as client:
                response = self.client.post(_ENDPOINT + "/test", json=body)
                self.assertIn(response.status_code, {400, 422})
                client.assert_not_called()
                self.assert_private(response)
        with patch("src.research.settings.httpx.AsyncClient") as client:
            response = self.client.post(_ENDPOINT + "/test", content='{"api_key":"' + _KEY + '" broken}', headers={"Content-Type": "application/json"})
            self.assertIn(response.status_code, {400, 422})
            client.assert_not_called()
            self.assert_private(response)


if __name__ == "__main__":
    unittest.main()
