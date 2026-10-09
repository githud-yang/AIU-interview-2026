"""终端输入、显示和会话交互；模型与工具执行交给传入的智能体。"""
import httpx

from src.agent.core.llm_agent import ModelResponseError


def run_console(agent):
    history = []
    print("本地智能体（exit退出，/reset清空对话）")
    while True:
        try:
            text = input("你> ").strip()
            if text.lower() in {"exit", "quit"}:
                break
            if text == "/reset":
                history.clear()
                continue
            if not text:
                continue
            reply = agent.chat(text, history)
            print("助手>", reply)
            history.extend([{"role": "user", "content": text}, {"role": "assistant", "content": reply}])
            history = history[-20:]
        except (EOFError, KeyboardInterrupt):
            break
        except (httpx.HTTPError, ModelResponseError, ValueError) as exc:
            print("请求失败：", exc)
