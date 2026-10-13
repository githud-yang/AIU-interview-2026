# AIU创智部二面 · 华小牛

本项目按面试题组织：本地大模型与智能体、YOLO训练/实时推理、创意应用，以及进阶科研Harness。硬件已由本人于2026-10-10确认完成，按实际项目展示。逐项状态见[交付核对](docs/submission-readiness.md)和[主清单](docs/checklist.md)。

面试直接打开[统一展示台](http://127.0.0.1:8000/showcase)：作品集开场点击“开始演示”，或[直接进入操作区](http://127.0.0.1:8000/showcase#agent)。作品和结果排在同一张固定连续页面，顶部导航分别直达智能体、YOLO、萤火、墨我知兮、企业协作、硬件、科研与工程。文字冒险与YOLO在本页操作，训练曲线直接显示；萤火点击加载后保留在同页固定区域，沿用当前浏览器中的本地数据，[墨我知兮简介](http://127.0.0.1:8000/showcase#mowozhixi)只展示链接与简介。[科研区](http://127.0.0.1:8000/showcase#harness)默认显示中文报告，可切英文原稿、下载双语PDF；“现场操作”在同页展开真实工作台，“期刊与选题”直达三刊背调。工程资料收在页底。建议演示6–8分钟，具体操作见[demo.md](docs/demo.md)。

创意作品新增：[萤火随笔与英语学习应用](showcases/yinghuo/README.md)，独立源码已纳入`showcases/yinghuo`。后端AI/SSE、Key设置、虚构演示与说明已补齐，完成5次真实DeepSeek调用；[评估和验收](docs/yinghuo-assessment.md)分别记录软件检查与浏览器待验收项。

[墨我知兮](https://121.43.165.79/)：国家级大学生创新创业训练计划项目，本人担任项目负责人。面向高校中文表达训练与文学创作，融合文学语料治理、RAG风格检索与可追溯交互，贯通原稿输入、局部推敲、自主取舍、版本回溯与创作历程导出，服务表达能力培养与教师过程性评价。已形成云端写作平台，并开展基于Qwen轻量模型的LoRA风格适配实验。

企业协作经历：[华农校园百事通AI智能体](showcases/campus-assistant/README.md)。暑期实习期间担任项目负责人，与润建股份协作推进校园服务智能体建设；阶段形成262份知识文档、10个知识板块和11个业务工作流。[项目网站](https://hzau.rundecloud.com/)。

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

基础网页/智能体可只安装`requirements.txt`，视觉模块用`requirements-yolo.txt`，科研完整环境用`requirements-research.txt`；CUDA版PyTorch按设备配置。YOLO权重不进Git；训练入口与权重准备见[视觉模块说明](src/yolo/README.md)，本次展示对应[野生动物训练记录](docs/wildlife_training_result.json)。主工作台前端无npm构建步骤；萤火独立使用Node，启动见[创意作品说明](showcases/README.md)。

| 入口 | 功能与分类 |
| --- | --- |
| [统一展示台](http://127.0.0.1:8000/showcase) | 首入口：固定连续页，直接操作作品并展示训练与科研结果 |
| [文字冒险](http://127.0.0.1:8000/) | 本地智能体/API应用，同时作为创意作品 |
| [视觉检测](http://127.0.0.1:8000/yolo) | YOLO基础任务，公开图/本地视频/摄像头 |
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
- YOLO保留本人原始13行训练脚本：`yolo11n.pt`、`african-wildlife.yaml`、`epochs=10`、`imgsz=640`、`batch=28`、`cache="ram"`、`workers=1`；展示原项目同参数`train12`保存的10轮CSV和曲线。公交车/行人的实时检测使用独立的通用检测权重，已有公开图、HTTP双流和本地短视频实测；摄像头现场效果仍需复验。
- 科研完成digits高斯增强和YOLO固定权重320/480/640两个任务的12阶段运行。最新YOLO为202秒、6次模型请求、5个评测作业、0次训练；追加中文阅读版后331个登记产物哈希一致，原始实验不变。选参选择480，但第二拆分未复现其速度优势。COCO128可能与预训练重叠，不是独立泛化证据。
- 科研论文模块支持在本机配置DeepSeek Key，测试并保存后即时切换；模型接口与运行记录见科研模块说明。萤火是独立应用，已完成5类真实DeepSeek请求。
- 灵感/期刊首批资料与编辑草稿已整理；自动全文差异矩阵、自动背调决策、便携冻结重放、外部科学评价及真实投稿未完成。

完整核验见[verification.md](docs/verification.md)，操作见[research-workbench.md](docs/research-workbench.md)，演示见[demo.md](docs/demo.md)。`docs/evidence/`是训练证据，根`evidence/`是研究摘要；完整原始运行在忽略Git的`logs/research/`。归档不参与启动或计入成果。

## 验证

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs
```

默认不打开私人摄像头、不调用云端模型。真实YOLO测试需设置`YOLO_RUNTIME_TEST=1`。固定连续页已实测八项导航、开场与深链、小屏布局、本地模型回复、公开图检测与停止、萤火白天载入；同页科研任务/阶段/实验/事件/材料、双语报告和期刊表也已实测，见[evidence/research-stage-20261011.json](evidence/research-stage-20261011.json)。实际投屏与本人讲解、论文Key设置完整浏览器流程、萤火编辑/刷新持久化/备份仍单独核验。2026-10-13交付复核见[交付核对](docs/submission-readiness.md)，旧截图不作为当天新鲜浏览器验收。

仓库：[AIU-interview-2026](https://github.com/githud-yang/AIU-interview-2026)。
