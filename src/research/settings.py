"""Local DeepSeek paper settings; credentials never appear in returned state."""
from __future__ import annotations

import os
import re
import uuid
from pathlib import Path

import httpx
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from .writer import WriterRouter

DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"


class SettingsError(ValueError):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


class DeepSeekRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    api_key: SecretStr | None = None
    model: str = Field(default="deepseek-flash", min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.-]+$")

    @field_validator("api_key", mode="before")
    @classmethod
    def key_format(cls, value):
        if value is None:
            return None
        raw = value.get_secret_value() if isinstance(value, SecretStr) else value
        if not isinstance(raw, str):
            raise ValueError("API key must be text")
        if not raw.strip():
            return None
        if not 8 <= len(raw) <= 512 or not re.fullmatch(r"[A-Za-z0-9_.-]+", raw):
            raise ValueError("Invalid API key format")
        return raw  # Pydantic wraps it after this validator, including JSON mode.


class DeepSeekSettings:
    def __init__(self, env_path: Path, research_service):
        self.env_path = Path(env_path).resolve()
        self.service = research_service

    def busy(self):
        return bool(self.service.closing or self.service.exporting or any(
            run["status"] in {"queued", "running", "cancelling"} for run in self.service.store.list_runs()))

    def status(self):
        writer = self.service.provider.writer
        current_model = writer.config["model"] if writer.config else (
            "Codex CLI default (isolated config)" if writer.provider == "codex" else "Same as controller")
        busy = self.busy() or self.service.configuring
        return {"provider": writer.provider, "model": current_model,
            "configured_provider": os.getenv("RESEARCH_WRITER_PROVIDER", "auto"),
            "key_configured": bool(os.getenv("DEEPSEEK_API_KEY")), "base_url": DEEPSEEK_BASE_URL,
            "deepseek_model": current_model if writer.provider == "deepseek" else "deepseek-flash",
            "editable": not busy, "busy": busy}

    async def test(self, body: DeepSeekRequest):
        key = body.api_key.get_secret_value() if body.api_key else os.getenv("DEEPSEEK_API_KEY", "")
        if not key:
            raise SettingsError("请填写 DeepSeek API key；留空只能复用已保存的密钥")
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(8, connect=4), trust_env=False, follow_redirects=False) as client:
                response = await client.get(DEEPSEEK_BASE_URL + "/models", headers={"Authorization": "Bearer " + key})
        except httpx.TimeoutException:
            raise SettingsError("DeepSeek 连接超时，请稍后重试", 504) from None
        except httpx.HTTPError:
            raise SettingsError("无法连接 DeepSeek 官方接口，请检查网络", 502) from None
        if response.status_code in {401, 403}:
            raise SettingsError("DeepSeek 拒绝了该密钥，请检查密钥是否有效", 400)
        if response.status_code == 429:
            raise SettingsError("DeepSeek 暂时限制请求，请稍后重试", 429)
        if response.status_code != 200:
            raise SettingsError("DeepSeek 服务暂不可用，原配置未修改", 502)
        try:
            data = response.json()["data"]
            if not isinstance(data, list) or not data or any(not isinstance(item, dict) or not isinstance(item.get("id"), str) for item in data):
                raise ValueError("Malformed model list")
            models = [item["id"] for item in data if re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", item["id"]) and key not in item["id"]]
        except (ValueError, KeyError, TypeError):
            raise SettingsError("DeepSeek 返回的模型列表无法校验，原配置未修改", 502) from None
        if body.model not in models:
            raise SettingsError("密钥可连接，但所填模型不在该账号的可用列表中")
        return {"ok": True, "model": body.model, "available_models": models,
            "configured": bool(os.getenv("DEEPSEEK_API_KEY")),
            "message": "密钥验证通过，所选模型可用；尚未修改配置或执行论文生成"}

    def _persist(self, updates):
        original = self.env_path.read_text(encoding="utf-8-sig") if self.env_path.exists() else ""
        lines, seen = [], set()
        for line in original.splitlines():
            name = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else None
            if name in updates:
                if name not in seen:
                    lines.append(name + "=" + updates[name])
                    seen.add(name)
            else:
                lines.append(line)
        lines.extend(name + "=" + value for name, value in updates.items() if name not in seen)
        self.env_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.env_path.with_name(self.env_path.name + "." + uuid.uuid4().hex + ".tmp")
        try:
            with temporary.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write("\n".join(lines) + "\n")
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(self.env_path)
        finally:
            temporary.unlink(missing_ok=True)

    async def save(self, body: DeepSeekRequest):
        if self.busy() or self.service.configuring:
            raise SettingsError("研究或导出正在执行，请结束后再保存论文模型设置", 409)
        self.service.configuring = True
        self.service.settings_done.clear()
        updates = None
        previous = None
        committed = False
        try:
            await self.test(body)
            if self.busy():
                raise SettingsError("研究状态已变化，原配置未修改，请稍后保存", 409)
            key = body.api_key.get_secret_value() if body.api_key else os.getenv("DEEPSEEK_API_KEY", "")
            updates = {"DEEPSEEK_API_KEY": key, "DEEPSEEK_BASE_URL": DEEPSEEK_BASE_URL,
                       "RESEARCH_WRITER_PROVIDER": "deepseek", "RESEARCH_WRITER_MODEL": body.model}
            previous = {name: os.environ.get(name) for name in updates}
            os.environ.update(updates)
            writer = WriterRouter(self.service.store)
            self._persist(updates)
            self.service.provider.writer = writer
            committed = True
        except OSError:
            raise SettingsError("本机配置保存失败，原设置仍保留", 500) from None
        finally:
            if previous is not None and not committed:
                for name, value in previous.items():
                    if value is None:
                        os.environ.pop(name, None)
                    else:
                        os.environ[name] = value
            self.service.configuring = False
            self.service.settings_done.set()
        return {"ok": True, "settings": self.status(), "message": "DeepSeek 已保存并启用，将用于后续论文写作与审阅"}
