"""OpenAI 兼容模型调用与有界工具循环，CLI 和 Web 共用。"""
from __future__ import annotations
import json
import logging
import os
import time
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import urlsplit
import httpx
from src.agent.tools.registry import TOOLS
logger = logging.getLogger(__name__)
_deadline = ContextVar("agent_deadline", default=None)

class ModelResponseError(RuntimeError):
    """服务可达，但响应不符合约定。"""

def _load_env():
    env_path = Path(__file__).resolve().parents[3] / "configs" / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
_load_env()

def _get_provider_config():
    provider = os.getenv("LLM_PROVIDER", "ollama").strip().lower()
    if provider not in {"ollama", "deepseek"}:
        raise ValueError("LLM_PROVIDER 仅支持 ollama 或 deepseek")
    prefix = provider.upper()
    default_url = "http://127.0.0.1:11434" if provider == "ollama" else "https://api.deepseek.com"
    base = os.getenv(f"{prefix}_BASE_URL", default_url).rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("模型地址必须是完整 HTTP(S) URL")
    return {"provider": provider, "base_url": base if base.endswith("/v1") else base + "/v1",
            "model": os.getenv(f"{prefix}_MODEL", "qwen2.5:7b" if provider == "ollama" else "deepseek-chat"),
            "api_key": os.getenv(f"{prefix}_API_KEY", "ollama" if provider == "ollama" else ""),
            "trust_env": parts.hostname not in {"localhost", "127.0.0.1", "::1"}}

class LocalLLMAgent:
    def __init__(self, system_prompt=None, tools=None):
        cfg = _get_provider_config()
        self.base_url, self.model, self.api_key = cfg["base_url"], cfg["model"], cfg["api_key"]
        self.provider, self.trust_env = cfg["provider"], cfg["trust_env"]
        self.tools = TOOLS if tools is None else tools
        self.system_prompt = system_prompt or "你是中文助手。查询时间、计算和记录笔记需要调用工具，不能编造工具结果。"

    def _headers(self):
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

    def health(self):
        result = {"provider": self.provider, "model": self.model, "available": False, "error": ""}
        if self.provider == "deepseek" and not self.api_key:
            result["error"] = "尚未配置云端 API 密钥"
            return result
        try:
            response = httpx.get(f"{self.base_url}/models", headers=self._headers(), timeout=3, trust_env=self.trust_env)
            response.raise_for_status()
            result["available"] = any(item.get("id") == self.model for item in response.json()["data"])
            if not result["available"]:
                result["error"] = "服务已连接，配置的模型未在模型列表中找到"
        except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
            result["error"] = "模型服务未连接，请检查服务和配置"
        return result

    def _chat_completion(self, messages, tools=None):
        if self.provider == "deepseek" and not self.api_key:
            raise ModelResponseError("尚未配置云端 API 密钥")
        payload = {"model": self.model, "messages": messages, "stream": False, "max_tokens": 768}
        if tools:
            payload["tools"] = tools
        deadline = _deadline.get()
        remaining = 120 if deadline is None else min(120, deadline - time.monotonic())
        if remaining <= 0:
            raise ModelResponseError("模型执行已达到时间预算，请缩小任务范围")
        response = httpx.post(f"{self.base_url}/chat/completions", json=payload,
                              headers=self._headers(), timeout=httpx.Timeout(remaining, connect=min(5, remaining)), trust_env=self.trust_env)
        response.raise_for_status()
        try:
            message = response.json()["choices"][0]["message"]
            if not isinstance(message, dict): raise TypeError("message 必须为对象")
            return message
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ModelResponseError("模型返回格式异常，请检查模型接口兼容性") from exc

    def _execute_tool(self, call):
        try:
            function = call["function"]
            name = function["name"]
            if name not in self.tools: raise ValueError("工具未注册")
            raw = function.get("arguments", "{}")
            args = json.loads(raw) if isinstance(raw, str) else raw
            if not isinstance(args, dict): raise ValueError("工具参数必须为对象")
            parameters = self.tools[name]["schema"]["function"]["parameters"]
            properties = parameters.get("properties", {})
            if set(args) - set(properties) or set(parameters.get("required", [])) - set(args):
                raise ValueError("工具参数缺失或包含未知字段")
            for key, value in args.items():
                if properties[key].get("type") == "string" and not isinstance(value, str):
                    raise ValueError(f"{key} 必须是字符串")
            return str(self.tools[name]["fn"](**args))[:8000]
        except Exception as exc:
            logger.warning("工具调用失败: %s", type(exc).__name__)
            return f"工具调用失败：{exc}"

    def chat(self, user_input, history=None):
        token = _deadline.set(time.monotonic() + 180)
        try:
            return self._chat(user_input, history)
        finally:
            _deadline.reset(token)

    def _chat(self, user_input, history=None):
        if not isinstance(user_input, str) or not user_input.strip() or len(user_input) > 4000:
            raise ValueError("消息长度必须在 1 到 4000 字符之间")
        messages = [{"role": "system", "content": self.system_prompt}]
        recent = []
        characters = len(self.system_prompt) + len(user_input)
        for turn in reversed((history or [])[-20:]):
            if turn.get("role") not in {"user", "assistant"} or not isinstance(turn.get("content"), str):
                raise ValueError("历史消息只允许 user/assistant 文本")
            content = turn["content"][:12000]
            if characters + len(content) > 24000:
                break
            recent.append({"role": turn["role"], "content": content})
            characters += len(content)
        recent.reverse()
        if recent and recent[0]["role"] == "assistant":
            recent.pop(0)
        messages.extend(recent)
        messages.append({"role": "user", "content": user_input.strip()})
        schemas = [tool["schema"] for tool in self.tools.values()]
        started, total_calls = time.monotonic(), 0
        for round_index in range(6):
            response = self._chat_completion(messages, schemas if round_index < 5 and total_calls < 10 else None)
            calls = response.get("tool_calls") or []
            if not calls:
                content = response.get("content")
                if not isinstance(content, str) or not content.strip():
                    raise ModelResponseError("模型返回了空回复，请重试")
                return content.strip()
            if not isinstance(calls, list) or len(calls) > 10 or total_calls + len(calls) > 10:
                raise ModelResponseError("工具调用数量超过上限，请缩小任务范围")
            if round_index == 5 or time.monotonic() - started > 180:
                raise ModelResponseError("工具执行已达到预算，请缩小任务范围")
            ids = []
            for call in calls:
                if not isinstance(call, dict) or not isinstance(call.get("id"), str) or not call["id"] or not isinstance(call.get("function"), dict):
                    raise ModelResponseError("模型返回的工具调用格式异常")
                ids.append(call["id"])
            if len(ids) != len(set(ids)): raise ModelResponseError("模型返回重复的工具调用 ID")
            messages.append({"role": "assistant", "content": response.get("content"), "tool_calls": calls})
            for call in calls:
                observation = self._execute_tool(call)
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": observation})
                total_calls += 1
        raise ModelResponseError("模型未能完成回复")

def main():
    agent, history = LocalLLMAgent(), []
    print("本地智能体（exit 退出，/reset 清空对话）")
    while True:
        try:
            text = input("你> ").strip()
            if text.lower() in {"exit", "quit"}: break
            if text == "/reset":
                history.clear()
                continue
            if not text: continue
            reply = agent.chat(text, history)
            print("助手>", reply)
            history.extend([{"role": "user", "content": text}, {"role": "assistant", "content": reply}])
            history = history[-20:]
        except (EOFError, KeyboardInterrupt): break
        except (httpx.HTTPError, ModelResponseError, ValueError) as exc: print("请求失败：", exc)
if __name__ == "__main__": main()
