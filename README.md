# AIU创智部二面 · 华小牛

本项目按面试题组织：本地大模型与智能体、YOLO训练/实时推理、创意应用，以及进阶科研Harness。硬件已由本人于2026-10-10确认完成，按实际项目展示。逐项状态见[交付核对](docs/submission-readiness.md)和[主清单](docs/checklist.md)。

面试从[统一展示台](http://127.0.0.1:8000/showcase)进入：先看总览，再按基础→YOLO→萤火→硬件→Harness→工程与AI披露逐项演示，也可直接查看公开证据、运行只读预检。预检核对服务与已有材料，不启动研究、摄像头或云端模型；通过预检不代表最新界面已完成浏览器视觉验收。建议演示6–8分钟，具体提纲见[demo.md](docs/demo.md)。

创意作品新增：[萤火随笔与英语学习应用](showcases/yinghuo/README.md)，独立源码已纳入`showcases/yinghuo`。后端AI/SSE、Key设置、虚构演示与说明已补齐，完成5次真实DeepSeek调用；[评估和验收](docs/yinghuo-assessment.md)分别记录软件检查与浏览器待验收项。

## 启动

已有本机环境时，在仓库根目录执行：

```powershell
./scripts/start.ps1 -Background
# 停止本项目后台服务
./scripts/stop.ps1
```

新机器首次准备（推荐Python 3.11，需另行安装并运行Ollama）：

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements-research.txt
ollama pull qwen2.5:7b
Copy-Item configs/.env.example configs/.env
./scripts/start.ps1 -Background
```

基础网页/智能体可只安装`requirements.txt`，视觉模块用`requirements-yolo.txt`，科研完整环境用`requirements-research.txt`；CUDA版PyTorch按设备配置。YOLO权重不进Git，新机器按[视觉模块说明](src/yolo/README.md)与[训练记录](docs/training_result.json)恢复。主工作台前端无npm构建步骤；萤火独立使用Node，启动见[创意作品说明](showcases/README.md)。

| 入口 | 功能与分类 |
| --- | --- |
| [统一展示台](http://127.0.0.1:8000/showcase) | 首入口：总览、逐项演示、公开证据、只读预检 |
| [文字冒险](http://127.0.0.1:8000/) | 本地智能体/API应用，同时作为创意作品 |
| [视觉检测](http://127.0.0.1:8000/yolo) | YOLO基础任务，公开图/本地视频/摄像头 |
| [科研工作台](http://127.0.0.1:8000/research) | Harness进阶，两个注册科研任务 |
| [研究策划](http://127.0.0.1:8000/research/strategy) | 用户额外要求的灵感与期刊资料，探索功能 |
| [接口文档](http://127.0.0.1:8000/docs) | HTTP与事件订阅接口 |
| [萤火随笔](http://127.0.0.1:4318/notebook) | 独立创意作品，需单独启动 |

CLI：`./.venv/Scripts/python.exe -m src.agent.cli`。前台服务：`./scripts/start.ps1`，Ctrl+C停止。

## 模块与职责

```text
src/
  agent/       本地模型、工具、CLI交互
  yolo/        训练、推理、来源与证据
  web/
    main.py    只组装应用、资源和路由
    routes/    HTTP与推送接口适配
    services/  聊天、生命周期与事件推送
    managers/  共享视觉worker及设备资源
    static/    独立UI、HTTP客户端、事件订阅
  research/    进阶流程、账本、注册实验、写作与MCP
configs/       公开配置示例，本机密钥忽略Git
scripts/       启停、验证与运行工具
tests/         离线回归和显式启用的真实推理检查
docs/          要求核对、工程日志、演示与训练证据
evidence/      可提交的科研运行摘要
assets/        本机模型资源，二进制不进Git
archive/legacy/ 旧C++/ROS2练习和已替代原型
showcases/yinghuo/ 萤火独立创意作品源码快照（Node/React）
```

每个功能目录有短README。前端提交指令、订阅SSE/MJPEG并显示结果；模型调用、训练推理、指标计算、阶段推进、文件与Key保存全部在后端。传输适配独立封装。初始化、清理和健康检查不在主入口实现。结构说明见[src/README.md](src/README.md)。

## 完成证据与范围

- 本地Ollama + qwen2.5:7b、工具调用、游戏API已有真实验证。
- YOLO完成coco8真实30轮训练，参数、CSV、曲线和权重哈希齐备；共享推理线程、HTTP双流及本地短视频已实测。摄像头过去黑画面，现场演示尚未重新验收，已有公开图/视频备用。
- 科研完成digits高斯增强和YOLO固定权重320/480/640两个任务的12阶段运行。最新YOLO为202秒、6次模型请求、5个评测作业、0次训练，306个产物下载哈希一致；选参选择480，但第二拆分未复现其速度优势。COCO128可能与预训练重叠，不是独立泛化证据。
- 科研论文模块的DeepSeek Key接口已实现，在科研页本机填写、测试并保存即可即时切换；该模块尚无真实DeepSeek论文调用证据，既有Codex调用与回退按日志记录。萤火是独立应用，已完成5次真实DeepSeek请求，两者分别验收。
- 灵感/期刊首批资料与编辑草稿已整理；自动全文差异矩阵、自动背调决策、便携冻结重放、外部科学评价及真实投稿未完成。

完整核验见[verification.md](docs/verification.md)，操作见[research-workbench.md](docs/research-workbench.md)，演示见[demo.md](docs/demo.md)。`docs/evidence/`是训练证据，根`evidence/`是研究摘要；完整原始运行在忽略Git的`logs/research/`。归档不参与启动或计入成果。

## 验证与AI使用

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs
```

默认不打开私人摄像头、不调用云端模型。真实YOLO测试需设置`YOLO_RUNTIME_TEST=1`。用户已确认先前科研桌面布局正常；最新统一展示台、科研订阅改版与小屏视觉尚未实测，萤火完整编辑/刷新持久化和备份下载也仍需浏览器核验。只读预检和接口测试不替代这些检查。

截至2026-10-10本次核对，最近已知推送记录为`95d49a0`，包含此前的结构整理与萤火交付；后续新增改动是否提交、推送以实际Git记录为准。

原骨架由豆包辅助生成，之后由Codex对照题目修复、训练、验证和整理。模型生成解释与实测数据分别保留；本人应能解释实现思路、失败处理及证据范围。科研稿件、创新、真实投稿和录用分别验收。仓库：[AIU-interview-2026](https://github.com/githud-yang/AIU-interview-2026)。
