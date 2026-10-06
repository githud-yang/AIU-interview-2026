"""
LLM Agent核心模块
=================
统一封装本地Ollama和云端DeepSeek两种后端，对外暴露统一chat接口。
配置从项目根目录configs/.env读取，支持自动切换模型提供商。
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import httpx

from src.agent.tools.registry import TOOLS


def _load_env() -> None:
    """轻量读取项目根目录configs/.env，不依赖python-dotenv"""
    project_root = Path(__file__).resolve().parents[3]
    env_path = project_root / "configs" / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip("\"'"))


_load_env()


def _get_provider_config() -> dict:
    """根据环境变量获取当前模型提供商配置"""
    provider = os.getenv("LLM_PROVIDER", "ollama").lower()
    if provider == "deepseek":
        return {
            "base_url": os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").rstrip("/"),
            "model": os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
            "api_key": os.getenv("DEEPSEEK_API_KEY", ""),
        }
    return {
        "base_url": os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/") + "/v1",
        "model": os.getenv("OLLAMA_MODEL", "qwen2.5:7b"),
        "api_key": os.getenv("OLLAMA_API_KEY", "ollama"),
    }


class LocalLLMAgent:
    """大模型智能体，支持工具调用循环，对上层（CLI/Web）屏蔽后端差异"""

    def __init__(self, system_prompt: str | None = None) -> None:
        cfg = _get_provider_config()
        self.base_url = cfg["base_url"]
        self.model = cfg["model"]
        self.api_key = cfg["api_key"]
        self.provider = os.getenv("LLM_PROVIDER", "ollama").lower()
        self.system_prompt = system_prompt or (
            "你是「大冒险」游戏主持人。能调用本地工具时优先调用工具，不要编造时间或计算结果。"
            "回答简洁、中文。"
        )

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

    def _chat_completion(self, messages: list, tools: list | None = None) -> dict:
        """底层调用OpenAI兼容接口"""
        payload = {"model": self.model, "messages": messages, "stream": False}
        if tools:
            payload["tools"] = tools
        r = httpx.post(
            f"{self.base_url}/chat/completions",
            json=payload,
            headers=self._headers(),
            timeout=120,
            trust_env=False,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]

    def chat(self, user_input: str, history: list | None = None) -> str:
        """对外暴露的统一聊天接口，自动处理工具调用循环"""
        messages = [{"role": "system", "content": self.system_prompt}]
        if history:
            messages += history
        messages.append({"role": "user", "content": user_input})

        tool_schemas = [t["schema"] for t in TOOLS.values()]

        # 工具调用最多循环5轮，防止死循环
        for _ in range(5):
            resp = self._chat_completion(messages, tool_schemas)
            messages.append(resp)
            if not resp.get("tool_calls"):
                return resp.get("content", "")

            # 执行工具调用并把结果回传给模型
            for call in resp["tool_calls"]:
                name = call["function"]["name"]
                try:
                    args = json.loads(call["function"]["arguments"] or "{}")
                    observation = TOOLS[name]["fn"](**args)
                except (KeyError, TypeError, ValueError) as exc:
                    observation = f"工具调用失败：{exc}"
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "name": name,
                    "content": observation,
                })

        return self._chat_completion(messages).get("content", "")


def main():
    agent = LocalLLMAgent(system_prompt="你是中文助手，时间、计算和记录笔记需要调用工具。")
    history = []
    print("本地智能体（输入 exit 退出，/reset 清空对话）")
    while True:
        try:
            text = input("你> ").strip()
            if text.lower() in {"exit", "quit"}: break
            if text == "/reset":
                history.clear()
                continue
            if not text: continue
            reply = agent.chat(text, history[-20:])
            print("助手>", reply)
            history.extend([{"role":"user","content":text},{"role":"assistant","content":reply}])
        except (EOFError, KeyboardInterrupt): break
        except Exception as exc: print("请求失败：", exc)

if __name__ == "__main__":
    main()
