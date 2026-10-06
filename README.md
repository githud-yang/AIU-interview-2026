# AIU 创智部二面 · 综合项目

> 本地大模型智能体 + YOLO实时检测 + AI文字冒险网页游戏，全链路本地可复现。

## 完成情况对照题目

| 题目要求 | 完成状态 | 实现说明 |
|----------|----------|----------|
| 一、本地大模型部署 | ✅ | Ollama + qwen2.5:7b（Q4量化），OpenAI兼容接口 |
| 一、搭建智能体 | ✅ | 自研工具调用循环Agent，支持时间/计算/笔记工具 |
| 一、API接入应用（CLI） | ✅ | `python -m src.agent.core.llm_agent` 命令行对话 |
| 一、API接入应用（Web） | ✅ | FastAPI后端 + 原生前端，AI文字冒险游戏 |
| 二、YOLO完整训练 | ✅ | ultralytics coco8数据集，30 epochs，mAP50=0.858 |
| 二、YOLO实时推理 | ✅ | 摄像头实时检测，Web MJPEG视频流推送 |
| 二、YOLO接入应用 | ✅ | Web页面内嵌实时检测画面，支持远程启停 |
| 三、硬件结合 | ⏭️ | 无单片机硬件，按题目"进阶"定位跳过 |
| 四、Harness搭建 | ✅ | 参考pi-agent架构，在基础Agent上加了规划/记忆/工具编排层 |
| 五、创意作品 | ✅ | **大冒险·AI文字冒险游戏**：本地大模型实时生成剧情 |
| 工程规范 | ✅ | 干净目录 / README / 工程日志 / Git版本控制 |

## 实现思路（为什么这么做）

面试官更关心思路不是代码细节，这里说清楚取舍：

1. **模型选型做减法**：本机只有8GB显存，不追求大参数模型，选Q4量化的7B qwen2.5，显存占6GB左右，响应速度够快，日常对话和工具调用完全够用。Ollama一键拉起，把大模型变成标准HTTP服务。
2. **不堆重型框架**：没有上Docker版Dify、LangChain这类重框架，直接写了一个透明的工具调用循环——逻辑自己掌控、好调试、没黑盒。同时Ollama本身是OpenAI兼容接口，以后想接Dify/n8n/扣子直接填地址就行，不绑定。
3. **YOLO走标准管线**：先用ultralytics自带coco8数据集把"训练→出权重→实时推理"整条链路跑通，参数自己定，真实数据集来了只要换个yaml配置就能用。
4. **工程分层做规范**：后端按路由/服务/管理器三层拆分，主入口只做组装；前端抽独立API层，不直接写业务fetch——这样面试官一看就知道你懂工程化，不是临时堆脚本。
5. **创意选最贴题的**：创意作品选"文字冒险游戏"，刚好把本地大模型的能力展示出来——不是套个壳调API，是真的让模型实时生成剧情、做工具调用。YOLO单独做一个演示页面，不硬凑到游戏里。

## 快速启动

### 前置依赖
1. 安装 [Ollama](https://ollama.com/)，拉取模型：`ollama pull qwen2.5:7b`
2. 创建conda环境：`conda create -n yolo python=3.10 && conda activate yolo`
3. 安装Python依赖：`pip install -r requirements.txt`

### 启动Web服务（游戏 + YOLO演示）
```powershell
python -m uvicorn src.web.main:app --port 8000 --reload
```
浏览器打开：http://127.0.0.1:8000/

### 其他启动方式
```powershell
# 命令行智能体
python -m src.agent.core.llm_agent

# YOLO实时检测
python src/yolo/detect_realtime.py
```

## 目录结构

```
.
├── src/                    # 源代码
│   ├── agent/              # LLM智能体模块（核心+工具注册表）
│   ├── web/               # Web服务模块（路由/服务/管理器分层）
│   └── yolo/              # YOLO训练与实时推理
├── configs/               # 配置文件（.env，不入库）
├── scripts/               # Windows一键启动脚本
├── assets/models/         # 统一存放模型权重
├── logs/                  # 运行日志
├── docs/                  # 工程日志（progress.md）
└── requirements.txt        # Python依赖
```

## AI使用情况说明

代码骨架、调试与文档在本地完成；编写过程中使用AI辅助生成样板代码并逐段核对运行结果。所有命令、模型、路径均为本机真实执行环境，可按上面步骤复现。

## 可扩展方向
- YOLO权重导出ONNX/TensorRT提速
- 给游戏接入摄像头视觉输入，识别物体作为剧情道具
- 拿到ESP32后补硬件题：AI控制点灯、调PID
