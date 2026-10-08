"""
聊天服务模块
============
封装AI文字冒险游戏的业务逻辑，路由层只负责接收请求和返回结果，不处理业务细节。
"""
from __future__ import annotations

from src.agent.core.llm_agent import LocalLLMAgent
from src.agent.tools.registry import TOOLS

# 游戏系统提示词，单独抽离方便修改
GAME_SYSTEM_PROMPT = (
    "你是一个文字冒险游戏主持人。玩家身处一个可自由探索的场景，"
    "每轮用 3-4 句话描述当前发生的事并给出 2-3 个可选行动，推动剧情。"
    "开场场景设定为：玩家在一间摆满旧电脑的实验室醒来，桌上有一台闪着光标、"
    "已经跑起本地大模型的终端，一扇紧闭的门通向走廊。"
    "玩家已经读到终端上写着：欢迎回来。先看看周围，再决定下一步。"
)


class AdventureChatService:
    """AI文字冒险游戏服务，封装Agent调用和历史消息处理"""

    def __init__(self) -> None:
        self.agent = LocalLLMAgent(
            system_prompt=GAME_SYSTEM_PROMPT,
            tools={name: TOOLS[name] for name in ("get_time", "calculate")},
        )

    def chat(self, user_message: str, history: list[dict]) -> str:
        """处理用户聊天请求，返回AI回复"""
        # 只保留最近10轮历史，避免上下文过长
        trimmed_history = []
        for h in history[-10:]:
            trimmed_history.append({"role": "user", "content": h["user"]})
            trimmed_history.append({"role": "assistant", "content": h["ai"]})

        return self.agent.chat(user_message, history=trimmed_history)
