# 工程日志（progress）

记录项目的进度、卡点和思路变化，方便他人快速上手。

## 2026-10-01 环境勘察

- 机器：Windows，RTX 5070（8GB 显存，CUDA 13.1），D 盘剩余 185GB。
- 已有：Python 3.14 / Anaconda，conda 环境 `yolo`、`pest-yolo`、`labelimg`，`torch 2.11.0+cu128`、`opencv`。
- 结论：硬件够跑 7B/8B 量化模型和 YOLO；YOLO 直接复用已有 conda 环境。

## 2026-10-01 方案取舍

- **模型大小**：8GB 显存决定选 `qwen2.5:7b`（Q4 约 4.7GB），不贪大模型。
- **智能体框架**：没上 Docker 版 Dify（重、起容器麻烦），改为写一个透明的工具调用 Agent；Ollama 本身是 OpenAI 兼容接口，需要时可直接填进 Dify/n8n/扣子。做减法。
- **应用形态**：同时给 CLI（题目最基础档）和 Web（创意作品，加分档）。
- **硬件题（第三题）**：没有单片机，按题目"进阶"定位跳过，README 如实说明。
- **创意作品**：选"AI 文字冒险网页游戏"，长在本地大模型上，另把 YOLO 实时流做成第二个网页。

## 卡点 1：Ollama 静默安装参数

- 第一次用 `/VERYSILENT`（MSI 风格），安装没落地。
- 原因：OllamaSetup 是 NSIS 包，静默参数是大写 `/S`。改正后安装成功。

## 2026-10-01 落地顺序

1. 搭干净目录（llm-agent / yolo / webapp / docs）。
2. 装 Ollama → `ollama pull qwen2.5:7b`。
3. 写 Agent + CLI。
4. YOLO：`python train.py`（coco8，30 epoch）→ 实时推理。
5. FastAPI 把大模型和 YOLO 接进网页。
6. Git 初始化、写文档、推送 GitHub。

## 2026-10-01 实际跑通结果

- **本地模型**：winget 装 Ollama 0.35.0，`ollama pull qwen2.5:7b`（4.7GB）成功；调用 `get_time` 工具正常返回当前时间。
- **YOLO**：在 conda `yolo` 环境（torch 2.9.1+cu128，RTX 5070 Laptop）跑 coco8 训练 30 epoch，**mAP50=0.858**，best.pt 已落在 `yolo/runs/detect/coco8_baseline/weights/`，离线推理验证通过。
- **Web**：FastAPI 启动后首页 200，`/api/chat` 能调用本地模型生成剧情回复。
- **双 provider**：`llm-agent/.env.example` 留了 DeepSeek key 位置，切换 `LLM_PROVIDER` 即可在本地/云端间切换。

## 后续可优化

- YOLO 权重导出 ONNX/TensorRT 提速；
- 给游戏接 YOLO 视觉输入（用摄像头识别物体作为剧情道具）；
- 若拿到 ESP32，补第三题 AI 控制点灯。
