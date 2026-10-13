# 启元 · QIYUAN

**智能系统与创新实践平台**

启元把智能体、视觉感知、创作应用、校园服务、科研自动化与实物作品放进同一个实践体系：从问题与想法出发，完成系统实现、交互展示和运行验证。本仓库提供统一演示入口、模块化源码、训练成果与工程记录，用于AIU创智部二面及后续项目迭代。逐项状态见[交付核对](docs/submission-readiness.md)和[主清单](docs/checklist.md)。

面试直接打开[统一展示台](http://127.0.0.1:8000/showcase)：作品集开场点击“开始演示”，或[直接进入操作区](http://127.0.0.1:8000/showcase#agent)。作品和结果排在同一张固定连续页面，顶部导航分别直达智能体、YOLO、萤火、墨我知兮、企业协作、实物展示、科研与工程。文字冒险与YOLO在本页操作，训练曲线直接显示；萤火点击加载后保留在同页固定区域，沿用当前浏览器中的本地数据，[墨我知兮简介](http://127.0.0.1:8000/showcase#mowozhixi)只展示链接与简介。[科研区](http://127.0.0.1:8000/showcase#harness)使用常驻节点工作台：左侧选题与任务，中间12阶段画布，右侧默认展示论文、图表和关键结果，可直接页内阅读或下载PDF、实验数据和完整材料；点击节点切换输入/输出/证据。底部默认“论文与材料”，日志可另选。灵感和期刊资料在内部打开，可带入可编辑的分析重点。进入YOLO区自动开启摄像头，选择“行人视频案例”立即切换逐帧实时检测；离开释放本页启动的来源。工程资料收在页底。建议演示6–8分钟，具体操作见[demo.md](docs/demo.md)。

创意作品新增：[萤火随笔与英语学习应用](showcases/yinghuo/README.md)，独立源码已纳入`showcases/yinghuo`。后端AI/SSE、Key设置、虚构演示与说明已补齐，完成5次真实DeepSeek调用；[评估和验收](docs/yinghuo-assessment.md)分别记录软件检查与浏览器待验收项。

[墨我知兮](https://121.43.165.79/)：国家级大学生创新创业训练计划项目，本人担任项目负责人。面向高校中文表达训练与文学创作，融合文学语料治理、RAG风格检索与可追溯交互，贯通原稿输入、局部推敲、自主取舍、版本回溯与创作历程导出，服务表达能力培养与教师过程性评价。已形成云端写作平台，并开展基于Qwen轻量模型的LoRA风格适配实验。

企业协作经历：[华农校园百事通AI智能体](showcases/campus-assistant/README.md)。暑期实习期间担任项目负责人，与润建股份协作推进校园服务智能体建设；阶段形成262份知识文档、10个知识板块和11个业务工作流。[项目网站](https://hzau.rundecloud.com/)。

## 快速启动

已有本机环境时，在仓库根目录执行：

```powershell
./scripts/start.ps1 -Background
# 停止本项目后台服务
./scripts/stop.ps1
```

新电脑首次准备：先安装Python 3.11 64位、Ollama，并启动Ollama应用；萤火与前端检查另需Node.js 22.12+的兼容版本。在仓库根目录执行：

```powershell
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements-research.txt
./.venv/Scripts/python.exe scripts/setup_yolo_demo.py
ollama pull qwen2.5:7b
if (-not (Test-Path -LiteralPath configs/.env)) {
    Copy-Item -LiteralPath configs/.env.example -Destination configs/.env
}
# 仅在没有现成检测权重时，准备官方通用检测模型
if (-not (Test-Path -LiteralPath assets/models/best.pt)) {
    ./.venv/Scripts/python.exe -c "from pathlib import Path; from shutil import copy2; from ultralytics import YOLO; target=Path('assets/models/best.pt'); model=YOLO('yolo11n.pt'); target.parent.mkdir(parents=True, exist_ok=True); copy2(model.ckpt_path, target)"
    if ($LASTEXITCODE -ne 0) { throw 'YOLO权重下载失败，请检查网络后重试' }
}
./scripts/start.ps1 -Background
```

基础网页/智能体可只安装`requirements.txt`，视觉模块用`requirements-yolo.txt`，科研完整环境用`requirements-research.txt`；CUDA版PyTorch按设备配置。上述新机通用权重用于实时演示；本机已有权重保持原样，原训练成果无需重训。训练入口及成果见[视觉模块说明](src/yolo/README.md)与[野生动物训练记录](docs/wildlife_training_result.json)。主工作台前端无npm构建步骤。

萤火需要另开终端，独立启动页面与API；首次安装/构建后，后续只需`npm start`：

```powershell
cd showcases/yinghuo
npm ci
npm run build
npm start
```

主启动脚本只启动8000服务；Ollama与4318萤火分别运行。实时AI在各应用自己的设置中配置DeepSeek Key，两者配置独立。端口、CUDA、摄像头权限与排障见[运行环境与部署](docs/runtime-environment.md)。

Git包含训练曲线和科研验收摘要；完整历史科研数据库、论文与运行材料在本机`logs/research/`，不随Git下载。新电脑尚未迁移该目录时，科研工作台从空任务开始。迁移、查看历史材料和重新运行的区别见[新电脑说明](docs/runtime-environment.md#历史材料与新电脑)。

## 使用者电脑配置

以下为工程建议，基础档可采用CPU；实际速度随设备、上下文和同时运行的模块变化，不承诺固定FPS。

| 项目 | 基础运行建议 | 现场演示推荐 |
| --- | --- | --- |
| 系统 | Windows 11 64位，PowerShell 5.1或7 | 同左；当前启停脚本按Windows组织 |
| CPU | 4核8线程 | 6核12线程或以上 |
| 内存 | 16GB | 32GB或以上 |
| GPU | 可使用CPU推理 | 兼容NVIDIA GPU，显存8GB或以上；本地模型与YOLO同时运行建议12GB或以上 |
| 可用磁盘 | SSD预留30GB | SSD预留50GB；额外训练与科研产物另计 |
| 摄像头 | 内置或USB摄像头，允许桌面应用访问 | 720p或1080p；无摄像头时可切换动态视频案例 |
| 软件 | Python 3.11、Ollama、现代Edge/Chrome | 加装Node.js 22.12+兼容版本，用于萤火和前端检查 |
| 网络 | 首次安装、下载模型与视频需要联网 | DeepSeek、文献检索及外部项目访问需要联网 |

CPU档未作统一性能基准；GPU兼容性、模型内存开销和原训练脚本的资源需求详见[配置依据](docs/runtime-environment.md#配置依据与性能范围)。

| 入口 | 功能与分类 |
| --- | --- |
| [统一展示台](http://127.0.0.1:8000/showcase) | 首入口：固定连续页，直接操作作品并展示训练与科研结果 |
| [文字冒险](http://127.0.0.1:8000/) | 本地智能体/API应用，同时作为创意作品 |
| [视觉检测](http://127.0.0.1:8000/yolo) | YOLO基础任务，自动摄像头/动态视频案例切换 |
| [科研工作台](http://127.0.0.1:8000/research) | Harness进阶，两个注册科研任务 |
| [研究策划](http://127.0.0.1:8000/research/strategy) | 用户额外要求的灵感与期刊资料，探索功能 |
| [接口文档](http://127.0.0.1:8000/docs) | HTTP与事件订阅接口 |
| [萤火随笔·白天展示](http://127.0.0.1:4318/notebook?theme=day) | 独立创意作品，需单独启动；顶部可切换夜间 |

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
showcases/campus-assistant/ 校园智能体企业协作案例与演示简介
```

每个功能目录有短README。前端提交指令、订阅SSE/MJPEG并显示结果；模型调用、训练推理、指标计算、阶段推进、文件与Key保存全部在后端。传输适配独立封装。初始化、清理和健康检查不在主入口实现。结构说明见[src/README.md](src/README.md)。

## 完成证据与范围

- 本地Ollama + qwen2.5:7b、工具调用、游戏API已有真实验证。
- YOLO保留本人原始13行训练脚本：`yolo11n.pt`、`african-wildlife.yaml`、`epochs=10`、`imgsz=640`、`batch=28`、`cache="ram"`、`workers=1`；展示原项目同参数`train12`保存的10轮CSV和曲线。摄像头/行人视频实时检测使用独立的通用检测权重，已有摄像头连续读帧、动态视频HTTP双流与本地短视频实测；摄像头和案例均逐帧现算。
- 科研完成digits高斯增强和YOLO固定权重320/480/640两个任务的12阶段运行。已归档的YOLO示例为202秒、6次模型请求、5个评测作业、0次训练；追加中文阅读版后331个登记产物哈希一致，原始实验不变。该示例选参选择480，但第二拆分未复现其速度优势。每次运行的结果与材料分别展示。COCO128可能与预训练重叠，不是独立泛化证据。
- 科研论文模块支持在本机配置DeepSeek Key，测试并保存后即时切换；模型接口与运行记录见科研模块说明。萤火是独立应用，已完成5类真实DeepSeek请求。
- 灵感/期刊首批资料与编辑草稿已整理；自动全文差异矩阵、自动背调决策、便携冻结重放、外部科学评价及真实投稿未完成。

完整核验见[verification.md](docs/verification.md)，操作见[research-workbench.md](docs/research-workbench.md)，演示见[demo.md](docs/demo.md)。`docs/evidence/`是训练证据，根`evidence/`是研究摘要；完整原始运行在忽略Git的`logs/research/`。归档不参与启动或计入成果。

## 验证

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs tests/test_showcase_frontend.mjs tests/test_showcase_live.mjs tests/test_showcase_navigation.mjs tests/test_showcase_research_frontend.mjs tests/test_research_workflow.mjs tests/test_research_outcomes.mjs
```

上述命令是自动化回归，默认不占用摄像头、不调用云端模型。显式设置`YOLO_RUNTIME_TEST=1`才运行真实YOLO测试，该测试采用公开图和临时视频。**应用运行行为不同：进入展示台YOLO区或打开独立`/yolo`页即自动开启运行服务的电脑上的摄像头；选择“行人视频案例”自动换源。** 测试范围见[tests/README.md](tests/README.md)。

2026-10-14复核：Python178项中176通过、2项条件跳过，Node89项通过。摄像头连续读帧、动态视频与换源于2026-10-13实测，2026-10-14获本人页面确认，见[换源验收](evidence/showcase-live-sources-20261013.json)。八项导航、小屏、萤火白天载入及科研任务/阶段/事件/材料、双语报告和期刊表另有[浏览器记录](evidence/research-stage-20261011.json)。实际投屏与本人讲解、论文Key设置完整浏览器流程、萤火编辑/刷新持久化/备份仍单独核验。准确交付范围见[交付核对](docs/submission-readiness.md)。

仓库：[AIU-interview-2026](https://github.com/githud-yang/AIU-interview-2026)。
