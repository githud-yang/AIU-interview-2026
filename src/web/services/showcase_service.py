"""组织面试顺序和可公开证据；预检只读取本地状态，不运行模型或实验。"""
from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[3]
TRAINING = "docs/evidence/coco8_baseline_20261008T032907553783Z"
FILES = {
    "requirements": ("docs/submission-readiness.md", "text/plain"),
    "architecture": ("docs/structure.md", "text/plain"),
    "demo-guide": ("docs/demo.md", "text/plain"),
    "agent-proof": ("docs/verification.md", "text/plain"),
    "training": ("docs/training_result.json", "application/json"),
    "training-curve": (f"{TRAINING}/results.png", "image/png"),
    "public-detection": ("docs/evidence/yolo-public-sample.jpg", "image/jpeg"),
    "yolo-proof": ("docs/evidence/yolo-runtime-smoke.json", "application/json"),
    "yinghuo-proof": ("evidence/yinghuo-showcase-smoke.json", "application/json"),
    "yinghuo-guide": ("showcases/yinghuo/docs/interview-demo.md", "text/plain"),
    "research-proof": ("evidence/research-yolo-runtime-smoke.json", "application/json"),
    "engineering-proof": ("evidence/structure-and-sse-smoke.json", "application/json"),
}


def public_file(file_id: str, root: Path = ROOT):
    """只允许固定展示资料，不跟随指向其他文件的符号链接。"""
    entry = FILES.get(file_id)
    if entry is None:
        return None
    root = root.resolve()
    path = root / entry[0]
    try:
        if path.resolve() != path.absolute() or not path.is_file():
            return None
    except (OSError, RuntimeError):
        return None
    return path, entry[1]


def catalog(root: Path = ROOT):
    """交付事实与演示操作分开；历史实测不代替当前服务在线状态。"""
    cards = [
        {"id": "agent", "title": "本地模型与自己的智能体", "category": "基础任务", "status": "已有真实运行记录",
         "summary": "从本地模型到工具调用，再通过 API 接入文字冒险。",
         "proof": ["Ollama + qwen2.5:7b 已实际调用", "工具循环、输入校验与游戏 API 已验证"],
         "talk": ["打开文字冒险，输入“看看终端屏幕”，展示一次实际交互。", "解释：界面提交请求，后端组织上下文和工具循环，模型服务生成回复。", "若被问到工具，展示验收记录中的计算器调用，再说明未知工具/错误如何处理。"],
         "actions": [{"label": "打开文字冒险", "href": "/"}],
         "evidence": [{"label": "模型与工具验收", "id": "agent-proof", "kind": "text"}],
         "limitation": "现场能否即时回复取决于本地模型服务；可先用顶部预检确认。"},
        {"id": "yolo", "title": "YOLO 训练与实时检测", "category": "基础任务", "status": "训练与推理已有证据",
         "summary": "展示训练曲线，再打开公开样例推理；摄像头按现场情况使用。",
         "proof": ["coco8 真实训练 30 轮，CSV/曲线/权重哈希已归档", "公开图双客户端流与短视频推理已实际验证"],
         "talk": ["先展示训练曲线，说明训练数据、轮数和评测范围。", "打开视觉检测，选择“公开静态样例”，主动点击启动，展示预测框后停止。", "说明前端订阅状态/画面，后端共享一个推理 worker。"],
         "actions": [{"label": "打开视觉检测", "href": "/yolo"}],
         "evidence": [{"label": "训练曲线", "id": "training-curve", "kind": "image"}, {"label": "训练参数与记录", "id": "training", "kind": "text"}, {"label": "检测示例", "id": "public-detection", "kind": "image"}, {"label": "推理验收", "id": "yolo-proof", "kind": "text"}],
         "limitation": "公开静态图、视频和摄像头要分别说明；过去摄像头黑画面尚未补验，coco8 不代表真实泛化。"},
        {"id": "yinghuo", "title": "萤火：随笔与英语表达", "category": "创意作品", "status": "5 类真实云调用通过",
         "summary": "中文记录、英语学习、文字知己，展示一个有明确使用场景的产品。",
         "proof": ["47 项检查：46 通过，1 项系统权限跳过", "翻译/金句、选句、查词、画像、对话 5 次真实 DeepSeek 调用成功"],
         "talk": ["打开萤火，导入“演示日记集（虚构）”，展示编辑、预写译文和词汇卡片。", "主动提炼一篇虚构随笔，再发送一条知己消息；区分预写样例与刚生成的回复。", "说明 Key 保存在本机后端，随笔平时在浏览器本地，主动请求 AI 时才发送相关内容。"],
         "actions": [{"label": "打开萤火", "href": "http://127.0.0.1:4318/notebook"}],
         "evidence": [{"label": "真实调用与检查", "id": "yinghuo-proof", "kind": "text"}, {"label": "萤火演示提纲", "id": "yinghuo-guide", "kind": "text"}],
         "limitation": "演示随笔与预写画像明确为虚构；人格是提示词和上下文归纳，没有训练个人模型。完整浏览器持久化仍待现场验收。"},
        {"id": "hardware", "title": "硬件作品：现场展示", "category": "进阶加分", "status": "本人确认已完成",
         "summary": "以你已完成的实物和真实功能为准，现场演示输入到输出。",
         "proof": ["本人于 2026-10-10 确认硬件任务完成", "当前软件项目没有替你推定 PID 或板端模型层级"],
         "talk": ["拿出实物，说明希望解决什么问题，以及输入、控制和输出分别是什么。", "现场操作一次，讲清连接关系及自己做过的调试。", "只介绍实际实现的功能；准备回答一次真实故障和修复过程。"],
         "actions": [], "evidence": [], "limitation": "完成状态来自本人确认；此页面不代表再次实物验收，也没有编造硬件参数。"},
        {"id": "harness", "title": "科研 Harness：持续执行与证据", "category": "进阶加分", "status": "固定任务已完整运行",
         "summary": "展示保存的完整运行、可追溯产物和恢复机制，现场无需重跑研究。",
         "proof": ["digits 与 YOLO 两个注册任务均完成 12 阶段", "YOLO 运行 202 秒，5 个评测作业；保留未复现速度优势的负结果"],
         "talk": ["打开科研工作台，选已有完成记录，展示阶段、日志和产物。", "解释检查点、幂等账本、哈希和中断恢复如何避免重复实验。", "展示 YOLO 的负结果，说明执行完整与科学创新是两件分别核验的事。"],
         "actions": [{"label": "打开科研工作台", "href": "/research"}, {"label": "查看选题策划", "href": "/research/strategy"}],
         "evidence": [{"label": "YOLO 完整运行证据", "id": "research-proof", "kind": "text"}],
         "limitation": "当前为固定 runner；通用代码研究、自动灵感/期刊决策、新环境重放和实际投稿仍未完成。二面基础不要求期刊录用。"},
        {"id": "engineering", "title": "代码组织与工程说明", "category": "交付收尾", "status": "源码与说明已推送",
         "summary": "最后用结构与证据回答“你是怎样组织、验证和改进项目的”。",
         "proof": ["功能模块封装、主入口组装、顶部简注、功能 README", "前后端通过 HTTP 与订阅解耦；启动命令与 AI 使用说明齐备"],
         "talk": ["打开 GitHub，沿 agent/yolo/web/research/showcases 说明任务分类。", "挑一个实际模块讲输入、输出、错误路径和测试，不逐行读代码。", "如实说明豆包/Codex 的辅助范围，再用自己的话解释设计取舍。"],
         "actions": [{"label": "打开 GitHub 源码", "href": "https://github.com/githud-yang/AIU-interview-2026"}],
         "evidence": [{"label": "模块结构", "id": "architecture", "kind": "text"}, {"label": "原题逐项核对", "id": "requirements", "kind": "text"}, {"label": "工程与订阅验收", "id": "engineering-proof", "kind": "text"}, {"label": "完整演示提纲", "id": "demo-guide", "kind": "text"}],
         "limitation": "代码数量和自动化检查不替代本人理解；面试结果还取决于讲解、追问与现场表现。"},
    ]
    for card in cards:
        for evidence in card["evidence"]:
            evidence["available"] = public_file(evidence["id"], root) is not None
    return {"title": "AIU 二面展示台", "verdict": "原题基础交付已覆盖；现场操作与本人讲解仍需彩排。",
            "checkedDate": "2026-10-10", "cards": cards,
            "checklist": ["用自己的话讲一次模型 → 工具 → API → 页面。", "萤火写一段虚构文字，切换/刷新确认保存，再试一次备份。", "现场摄像头先测试；不稳定时使用公开样例或视频并如实说明。", "硬件按实际实物展示，进阶科研展示已有运行即可。"]}


def preflight(agent, yolo_manager, research_available: bool, *, root: Path = ROOT):
    """只检查本地列表、文件和 HTTP 健康状态，不生成回复或启动检测。"""
    local_model = urlsplit(agent.base_url).hostname in {"localhost", "127.0.0.1", "::1"}
    model = agent.health() if local_model else {"available": False, "model": agent.model, "error": "当前配置非本地地址，请现场核对本地部署。"}
    services = [{"id": "agent", "label": "本地模型", "available": bool(model.get("available")), "detail": model.get("model", "") if model.get("available") else model.get("error", "模型未就绪")}]
    weights = Path(os.getenv("YOLO_WEIGHTS", "assets/models/best.pt")).expanduser()
    if not weights.is_absolute():
        weights = root / weights
    yolo = yolo_manager.status()
    services.append({"id": "yolo", "label": "检测权重", "available": weights.is_file(), "detail": "权重在本机；运行状态：" + str(yolo.get("state", "unknown")) if weights.is_file() else "权重未找到，请按视觉模块说明准备。"})
    try:
        response = httpx.get("http://127.0.0.1:4318/api/health", timeout=1.5, trust_env=False)
        response.raise_for_status()
        health = response.json()
        online = health.get("ok") is True
    except (httpx.HTTPError, ValueError, AttributeError):
        online = False
    services.append({"id": "yinghuo", "label": "萤火服务", "available": online, "detail": "本机 4318 服务已连接" if online else "服务未连接，请按萤火 README 启动 npm start。"})
    services.append({"id": "harness", "label": "科研服务", "available": research_available, "detail": "服务已加载，展示已有完成记录" if research_available else "科研依赖未就绪，已有证据仍可查看。"})
    return {"checkedAt": datetime.now(timezone.utc).isoformat(), "services": services,
            "note": "只读预检：不生成模型回复、不调用云端AI、不打开摄像头、不启动研究。在线状态不替代现场功能验收。"}
