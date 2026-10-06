"""不占用摄像头的回归检查；--live 额外调用真实 Ollama。"""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from src.web.main import app
from src.agent.tools.registry import tool_calculate
from src.agent.core.llm_agent import LocalLLMAgent

def main():
    p = argparse.ArgumentParser(); p.add_argument("--live", action="store_true"); a = p.parse_args()
    with TestClient(app) as c:
        for path in ["/", "/yolo", "/static/app.js", "/yolo/status"]:
            assert c.get(path).status_code == 200, path
        assert c.post("/api/chat", json={"message":""}).status_code == 422
        assert c.post("/api/chat", json={"message":"x", "history":[{"role":"system"}]}).status_code == 422
        assert c.get("/yolo/stream").status_code == 409
        assert tool_calculate("2^3") == "8"
        assert tool_calculate("(128+56)*3.5") == "644.0"
        assert "失败" in tool_calculate("2**99999")
        agent = LocalLLMAgent()
        responses = iter([{"role":"assistant","content":None,"tool_calls":[{"id":"t1","type":"function","function":{"name":"missing","arguments":"{"}}]}, {"role":"assistant","content":"已处理错误"}])
        agent._chat_completion = lambda *args: next(responses)
        assert agent.chat("test") == "已处理错误"
        if a.live:
            agent = LocalLLMAgent()
            calls = []
            original = agent._chat_completion
            def record(*args):
                result = original(*args); calls.extend(result.get("tool_calls", [])); return result
            agent._chat_completion = record
            reply = agent.chat("必须调用 calculate 工具计算 (128+56)*3.5")
            assert calls and "644" in reply, reply
            print("实际工具调用:", [x["function"]["name"] for x in calls], reply)
            r = c.post("/api/chat", json={"message":"看看终端屏幕", "history":[]})
            assert r.status_code == 200, r.text
            print("实际游戏回复:", r.json()["reply"])
    print("PASS: 页面、输入校验、工具循环、计算器" + ("、真实模型与游戏 API" if a.live else ""))
if __name__ == "__main__": main()
