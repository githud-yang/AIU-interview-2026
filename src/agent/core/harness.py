"""
Agent Harness 层
=================
基础原型；尚未完成与 pi-agent 架构的对应验证，在基础LLM Agent之上加一层执行外壳：
1. 任务规划：把用户的复杂请求拆成多步执行计划
2. 工具编排：自动调用多个工具完成任务
3. 会话记忆：记住之前的对话和笔记
4. 此模块为基础执行外壳，未实现视觉工具或自动科研
"""
from __future__ import annotations

from src.agent.core.llm_agent import LocalLLMAgent


class AgentHarness:
    """智能体执行外壳，在基础Agent之上加规划和多步任务能力"""

    def __init__(self) -> None:
        self.agent = LocalLLMAgent(
            system_prompt=(
                "你是一个具备多步任务规划能力的智能体。"
                "面对复杂任务时，先在心里拆解成步骤，再逐步调用工具完成。"
                "你可以调用：时间查询、数学计算、笔记记录。"
                "回答简洁，中文，不要暴露内部思考过程。"
            )
        )
        self.memory: list[dict] = []  # 会话记忆

    def plan_and_execute(self, user_input: str) -> str:
        """接收用户请求，自动规划并执行多步任务"""
        # 把历史记忆注入上下文
        history = self.memory[-10:]  # 保留最近10轮记忆

        # 调用基础Agent（自带工具调用循环）
        result = self.agent.chat(user_input, history=history)

        # 把这轮对话存入会话记忆
        self.memory.append({"role": "user", "content": user_input})
        self.memory.append({"role": "assistant", "content": result})

        return result

    def reset_memory(self) -> None:
        """清空会话记忆"""
        self.memory = []
