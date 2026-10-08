# AIU 创智部二面：终端迷局

以根目录《人工智能协会创智部二面题目（实战部分）》为要求，完成本地模型智能体、YOLO 与网页创意作品。保留一个 FastAPI 服务和原生网页，避免为了展示堆叠框架。

## 要求与交付

| PDF 要求 | 实现及证据 |
| --- | --- |
| 本地部署大模型 | Ollama + qwen2.5:7b，使用本机 OpenAI 兼容 API；`scripts/verify.py --live` 验证真实调用 |
| 智能体、API 接入应用 | 自研工具调用循环，时间、计算、笔记三个工具；CLI 与 `/api/chat` |
| Ultralytics 一次训练 | `src/yolo/train.py`，30 epochs、batch 4、imgsz 640、seed 42；真实结果见 `docs/training_result.json` |
| YOLO 实时部署、接入应用 | CLI 与网页 MJPEG；摄像头、公开静态样例及服务器配置的视频，单个推理线程供多个客户端共享 |
| 创意作品 | “终端迷局”文字冒险，模型根据玩家行动继续剧情，保留最近十轮 |
| 工程结构、日志、Git | 本文件、`docs/progress.md`、`docs/demo.md`；提交及云端同步须以 Git 实际记录为准 |
| 硬件（进阶） | 未做，没有单片机；不作为基础任务完成项 |
| Harness（进阶） | 当前仍为内存原型；现行 [全流程自动科研主计划](docs/harness-plan.md)涵盖文献、选题、代码、实验、迭代、论文核查与投稿适配，参考 Pi 分层及自动科研项目；计划不计为实现或论文成果 |

`exam1/` 和 `exam2/` 为以前的 C++ / ROS 练习，与本 PDF 无关，保留原件，不纳入本次完成情况。未提供超纲任务附件，不虚构相关成果。

## 从零复现

推荐 Python 3.11，同一环境同时安装网页与 YOLO 依赖：

```powershell
conda create -n aiu python=3.11
conda activate aiu
python -m pip install -r requirements-yolo.txt
ollama pull qwen2.5:7b
Copy-Item configs/.env.example configs/.env
```

Ollama 桌面程序需正在运行；默认地址 `http://127.0.0.1:11434`。在 `configs/.env` 更换模型、权重或摄像头编号，`YOLO_SOURCE` 可设 `camera`、`demo` 或 `video`。选本地视频时配置 `YOLO_VIDEO`，需要循环时设 `YOLO_VIDEO_LOOP=1`。没有 GPU 时使用 CPU；CUDA 版 PyTorch 应根据设备单独安装，不从文档猜测版本。

```powershell
# GPU 训练：有兼容 CUDA 的 PyTorch 时使用 --device 0
python src/yolo/train.py --epochs 30 --device cpu
# 离线检查 / 真实大模型检查
python scripts/verify.py
python scripts/verify.py --live
# 启动网页，打开 http://127.0.0.1:8000
python -m uvicorn src.web.main:app --host 127.0.0.1 --port 8000
# 命令行智能体
python -m src.agent.core.llm_agent
# 独立摄像头窗口（先停止网页检测，避免占用冲突）
python src/yolo/detect_realtime.py
# 无摄像头的真实公开图片检测，可用于面试备用演示
python src/yolo/detect_realtime.py --source demo --headless --max-frames 1 --save logs/demo-detection.jpg
```

本机已准备好 `D:/Anaconda3/envs/yolo/python.exe`，可用 `./scripts/start.ps1 -Python D:/Anaconda3/envs/yolo/python.exe` 启动。

## 验证命令

`python scripts/verify.py` 运行 Python 离线检查；`--live` 另验证真实 Ollama 工具和游戏 API。前端模拟状态检查用 `node --test tests/test_frontend.mjs`（需要 Node，网页运行本身不依赖 Node）。真实视觉检查独立启用，避免普通回归反复加载模型：

```powershell
$env:YOLO_RUNTIME_TEST = "1"
python -m unittest discover -s tests -p test_yolo_runtime.py -v
Remove-Item Env:YOLO_RUNTIME_TEST
```

该检查只使用公开图和它生成的三帧视频，在 127.0.0.1:8011 临时服务核验 HTTP 视频流，不打开摄像头。浏览器可视布局验收仍未完成，详情见验证记录。

## 训练与演示说明

训练输出位于 `runs/detect/coco8_baseline*`，脚本复制最佳权重到 `assets/models/best.pt`，提交用参数和指标保存到 `docs/training_result.json`。coco8 只有 4 张训练图、4 张验证图，这次训练只证明管线可复现，不声称真实场景准确率。大权重不进 Git，下载预训练模型并重跑训练可以获得可用权重；固定 seed 帮助复现，跨设备不保证数值完全相同。每次训练自动归档独立证据目录，保存 CSV、曲线、配置、环境版本和 SHA256；摘要分别注明最佳权重验证与最后一轮指标。

本机此前摄像头画面全黑，现场摄像头识别仍需检查遮挡、隐私开关和光照。公开 bus.jpg 样例已用本次 best.pt 真实推理，识别出公交车与行人；网页选择“公开静态样例”即可演示，也可配置本地视频。两类验证分别记录在 `docs/verification.md`。

网页检测使用服务器端的来源。启动后显示带框画面、已处理帧数及实测处理帧率；公开静态样例的帧率仅表示循环处理速度。模型加载失败、全黑画面、来源断开和停止超时有明确状态。关闭网页不会自动停止检测，需点停止；关闭服务会请求清理。不能用静态图片演示代替摄像头现场验收。

## 结构与思路

- `src/agent/`：API 请求、工具循环和工具注册；至多五轮工具调用、十次调用；仅允许普通对话历史，控制上下文长度并校验工具参数。
- `src/yolo/`：标准 Ultralytics 训练、CLI 推理。
- `src/web/`：页面、对话服务、共享摄像头管理。
- `configs/`：公开配置示例；真实 `.env` 和密钥不提交。
- `scripts/`：启动和验证；`docs/`：工程日志、真实指标和演示步骤。
- `assets/models/`、`runs/`、`logs/`：本机产物，Git 忽略。

网页显示模型连接状态，提供冒险引导、失败重试、重新开始和当前浏览器会话内的进度恢复。模型负责生成和选择工具；工具在 Python 执行，再将结果交回模型。计算器使用受限 AST，拒绝非有限数值和过大指数。CLI 的笔记工具写入 `logs/agent_notes.txt`；游戏只启用时间和计算工具。YOLO 页面不另起 conda 子进程，避免两路检测抢占同一个摄像头。同步推理与聊天运行于 FastAPI 线程池，避免阻塞异步事件循环。

## 服务接口

- `GET /api/health`：模型可达性、模型名称与视觉状态。
- `POST /api/chat`：`{message, history: [{user, ai}]}`，历史最多十轮；返回 `{reply}`。
- `GET /yolo/sources`、`GET /yolo/status`：来源可用性、启动/运行/停止/错误状态。
- `POST /yolo/start`：可选 `{source: "camera" | "demo" | "video"}`；启动异步加载，需继续读取状态。
- `POST /yolo/stop`：请求停止；返回 `ok=false` 时来源仍在释放，应等待状态。
- `GET /yolo/stream`：最新帧 MJPEG；未启动返回 409。
- `GET /docs`：FastAPI 自动接口说明。

## AI 使用情况

原始骨架由豆包辅助生成；2026-10-07 使用 Codex 对照 PDF 检查、修复代码、补训练脚本与配置、重做文档和运行验证。2026-10-08 继续审查运行边界、优化网页与视觉演示，调研 Pi、Deep Agents、OpenHands SDK。用户进一步明确全流程自动化目标后，核查 AI-Scientist-v2、AI-Researcher、Agent Laboratory，重写全流程科研主计划；视觉实验助手设计改为历史参考。新科研系统尚未实施，没有自动产出的高质量论文或投稿证据。此前文档的“全部完成”和旧 mAP 数值缺乏本目录证据，已撤下。提交者需要能解释调用链、训练参数、样例数据的局限及工具执行机制，不把 AI 生成文档当运行证据。

## 参考

- [Ollama 工具调用](https://ollama.com/blog/tool-support)
- [Ultralytics 训练](https://docs.ultralytics.com/modes/train/)
- [Ultralytics 推理](https://docs.ultralytics.com/modes/predict/)

本轮主进度见 [主清单](docs/checklist.md)，面试演示顺序见 [演示步骤](docs/demo.md)，Harness 后续实施见 [具体计划](docs/harness-plan.md)。云端仓库为 https://github.com/githud-yang/AIU-interview-2026 ，推送完成情况以 `git status` 和远端提交核验为准。
