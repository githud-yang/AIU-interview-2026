"""
Agent工具注册表模块
==================
所有可被大模型调用的工具统一在这里注册和管理，新增工具只需在此文件追加即可。
"""
from __future__ import annotations

import time
from pathlib import Path


def tool_get_time() -> str:
    """获取当前系统日期时间"""
    return time.strftime("%Y-%m-%d %H:%M:%S")


def tool_calculate(expr: str) -> str:
    """安全计算数学表达式，带字符白名单校验"""
    allowed = set("0123456789+-*/().%^ ")
    if not set(expr).issubset(allowed):
        return "错误：表达式包含非法字符"
    try:
        return str(eval(expr, {"__builtins__": {}}, {}))  # noqa: S307
    except Exception as e:  # noqa: BLE001
        return f"计算失败：{e}"


def tool_note(content: str) -> str:
    """将笔记内容追加写入本地文件"""
    note_path = Path(__file__).resolve().parents[2] / "agent_notes.txt"
    with open(note_path, "a", encoding="utf-8") as f:
        f.write(f"[{tool_get_time()}] {content}\n")
    return f"已记录：{content}"


# 工具注册表：schema + 实现函数 的映射
TOOLS = {
    "get_time": {
        "schema": {
            "type": "function",
            "function": {
                "name": "get_time",
                "description": "获取当前系统日期与时间",
                "parameters": {"type": "object", "properties": {}}
            }
        },
        "fn": tool_get_time,
    },
    "calculate": {
        "schema": {
            "type": "function",
            "function": {
                "name": "calculate",
                "description": "计算数学表达式，如 (128+56)*3.5",
                "parameters": {
                    "type": "object",
                    "properties": {"expr": {"type": "string"}},
                    "required": ["expr"]
                }
            }
        },
        "fn": tool_calculate,
    },
    "note": {
        "schema": {
            "type": "function",
            "function": {
                "name": "note",
                "description": "把待办/笔记保存到本地文件",
                "parameters": {
                    "type": "object",
                    "properties": {"content": {"type": "string"}},
                    "required": ["content"]
                }
            }
        },
        "fn": tool_note,
    },
}
