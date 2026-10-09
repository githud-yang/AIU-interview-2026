"""CLI主入口：只组装本地智能体与终端界面。"""
from src.agent.core.llm_agent import LocalLLMAgent
from src.agent.interfaces.console import run_console


def main():
    run_console(LocalLLMAgent())


if __name__ == "__main__":
    main()
