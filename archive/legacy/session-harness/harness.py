"""
Agent Harness 层
=================
基础原型；尚未完成与 pi-agent 架构的对应验证，在基础LLM Agent之上加一层执行外壳：
现状仅为模型工具循环与内存会话封装，尚无显式任务规划、磁盘会话、事件流、恢复。
实施计划见 docs/harness-plan.md。
"""
from __future__ import annotations

from src.agent.core.llm_agent import LocalLLMAgent


class AgentHarness:
    """基础会话封装；plan_and_execute 为旧接口名，不代表实现了规划器。"""

    def __init__(self) -> None:
        self.agent = LocalLLMAgent(
            system_prompt=(
                "你是一个本地实验助手。"
                "依据已有信息和工具结果回答；遇到工具失败需清楚说明。"
                "你可以调用：时间查询、数学计算、笔记记录。"
                "回答简洁，中文，不要暴露内部思考过程。"
            )
        )
        self.memory: list[dict] = []  # 会话记忆

    def plan_and_execute(self, user_input: str) -> str:
        """接收用户请求，自动规划并执行多步任务"""
        # 把历史记忆注入上下文
        history = self.memory[-20:]  # 保留最近10轮（20条消息）

        # 调用基础Agent（自带工具调用循环）
        result = self.agent.chat(user_input, history=history)

        # 把这轮对话存入会话记忆
        self.memory.append({"role": "user", "content": user_input})
        self.memory.append({"role": "assistant", "content": result})
        self.memory = self.memory[-20:]

        return result

    def reset_memory(self) -> None:
        """清空会话记忆"""
        self.memory = []
