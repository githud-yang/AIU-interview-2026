"""
Agent工具注册表模块
==================
所有可被大模型调用的工具统一在这里注册和管理，新增工具只需在此文件追加即可。
"""
from __future__ import annotations

import time
import ast
import operator
from pathlib import Path


def tool_get_time() -> str:
    """获取当前系统日期时间"""
    return time.strftime("%Y-%m-%d %H:%M:%S")


def tool_calculate(expr: str) -> str:
    """安全计算数学表达式，带字符白名单校验"""
    operations = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
                  ast.Div: operator.truediv, ast.Mod: operator.mod, ast.Pow: operator.pow}
    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            if abs(node.value) > 1e12: raise ValueError("数值过大")
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return visit(node.operand) * (-1 if isinstance(node.op, ast.USub) else 1)
        if isinstance(node, ast.BinOp) and type(node.op) in operations:
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 12: raise ValueError("指数过大")
            result = operations[type(node.op)](left, right)
            if isinstance(result, complex) or abs(result) > 1e100: raise ValueError("结果超出范围")
            return result
        raise ValueError("仅支持数字及加减乘除、取余和幂")
    try:
        if len(expr) > 200: raise ValueError("表达式过长")
        return str(visit(ast.parse(expr.replace("^", "**"), mode="eval").body))
    except Exception as exc:
        return f"计算失败：{exc}"



def tool_note(content: str) -> str:
    """将笔记内容追加写入本地文件"""
    note_path = Path(__file__).resolve().parents[3] / "logs" / "agent_notes.txt"
    note_path.parent.mkdir(parents=True, exist_ok=True)
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
