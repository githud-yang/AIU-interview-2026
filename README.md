# AIU 创智部二面：华小牛科研工作台

按根目录《人工智能协会创智部二面题目（实战部分）》修复基础项目，并实现首个自动科研领域。一个 FastAPI 服务提供科研工作台、文字冒险与 YOLO 页面。

## 要求与实际交付

| PDF 要求 | 当前实现及证据 |
| --- | --- |
| 本地大模型与智能体 | Ollama + qwen2.5:7b；工具调用循环、CLI 和 `/api/chat`；真实计算与游戏调用见 [验证记录](docs/verification.md) |
| Ultralytics 训练与应用 | coco8 真实 30 轮训练、最佳权重、共享推理线程、网页 MJPEG；[训练摘要](docs/training_result.json) 与 [视觉证据](docs/evidence/yolo-runtime-smoke.json) |
| 创意作品 | “终端迷局”文字冒险，行动推动剧情，保留当前浏览器会话最近十轮 |
| Harness 进阶 | `/research`：12 阶段工作流、LangGraph + SQLite、原始实验数据到稿件和复现包；已完成两次真实贯穿运行，见 [运行说明](docs/research-workbench.md) |
| 论文模型接入 | 已登录的本机 Codex CLI 完成分析、审查与修订三个真实调用；DeepSeek 网页 Key 设置、连接测试和即时切换已实现，未填入真实密钥，未做真实云端调用 |
| 工程与记录 | [主清单](docs/checklist.md)、[日志](docs/progress.md)、[面试演示](docs/demo.md)；Git 状态以实际提交及远端记录为准 |
| 实物与硬件 | 摄像头历史画面全黑，现场物体识别仍待验证；没有单片机，不计进阶硬件完成 |

当前自动研究是 **digits 分类的高斯训练增强实验**，使用已注册的固定 runner。研究目标可以表达问题，实验执行仍限定于这个领域。尚未实现任意生成代码沙箱、通用研究领域或实际投稿；生成候选稿不证明创新、外部评审通过或发表。

`exam1/`、`exam2/` 为无关历史练习，保留原件。未提供超纲任务附件，不虚构成果。

## 启动与复现

推荐 Python 3.11。本机 `.venv` 基于现有 YOLO 环境创建，科研依赖只装入该环境；MCP 使用独立 `.venv-mcp`。

```powershell
# 全新机器准备环境；CUDA 版 PyTorch 根据实际设备另行安装
python -m venv .venv
./.venv/Scripts/python.exe -X utf8 -m pip install -r requirements-research.txt
ollama pull qwen2.5:7b
Copy-Item configs/.env.example configs/.env
# 启动所有网页；Ollama 需已运行
./scripts/start.ps1 -Background
# 停止本脚本拥有的后台服务
./scripts/stop.ps1
```

打开 [科研工作台](http://127.0.0.1:8000/research)、[文字冒险](http://127.0.0.1:8000) 或 [视觉检测](http://127.0.0.1:8000/yolo)。前台启动可用 `./scripts/start.ps1`，按 Ctrl+C 停止。脚本优先选择项目 `.venv`，其次使用本机 `D:/Anaconda3/envs/yolo/python.exe`；`-Python` 和 `-Port` 可覆盖。

科研默认持续执行到本轮流程完成；累计耗时、模型请求和真实拟合次数用于记录，不默认作为停止条件。高级选项可由用户主动设置资源限额。单次网络请求仍有超时，避免一次断线挂住整个任务。限制、恢复及 API 例子见 [科研操作说明](docs/research-workbench.md)。

网页展开“论文模型设置”，填写 DeepSeek Key，选择模型，点击“测试连接”和“保存并启用”。测试读取官方模型列表，不生成论文；保存会再次验证并写入忽略提交的 `configs/.env`，成功后论文模块立即切换，无需重启。已配置时 Key 留空可复用。Key 不回显、不放入浏览器存储或运行证据；研究或导出进行中暂不可保存，避免一项任务中途更换模型。

Codex CLI 使用本机已有登录，不是调用当前对话的私有 API。未显式选择论文 provider 时，优先选择已配置的 DeepSeek、已配置并指定模型的 OpenAI，然后选择已登录的 Codex CLI，最后回退到控制模型；实际选择与失败写入运行记录。手动编辑配置文件或环境变量后需要重启；网页保存 DeepSeek 配置会即时生效。

## 真实研究结果

最新运行 `dd98c3f59cc34e73b7d2be3e3ec36899` 完成 12 个阶段，耗时 454.031 秒，7 次模型请求、18 次真实拟合、55 个已验证下载产物，研究内人工介入 0 次。[完整证据](evidence/research-writer-runtime-smoke.json) 保存当时状态快照；其旧资源上限是这次运行的历史配置，不是当前默认停止规则。

共享且固定的 60/20/20 分层训练、验证、测试划分上，三随机种子的结果为：

| 方法 | 干净输入准确率 | 噪声输入准确率 |
| --- | --- | --- |
| 无增强对照 | 97.5000% | 37.6852% |
| 验证集选出的高斯增强 | 95.1852% | 87.7778% |

噪声准确率提高约 50.09 个百分点，同时干净准确率降低约 2.31 个百分点。数值和图表从原始 CSV 重算，保留代价。最新第四版讨论正文已核查 10 个数字 token，保留此前版本与旧 67 个产物，累计 79 个登记产物下载哈希一致，新增模型请求和拟合均为 0；[导出证据](evidence/research-export-smoke.json)。基线和“去掉增强”的消融是同一对照的别名，不构成两份独立证据；种子标准差不是置信区间。两次软件贯穿运行复用同一固定划分，不构成新的独立科学确认。该已知方法用于验证工作流，创新性尚未验证。

## 验证与面试

```powershell
./.venv/Scripts/python.exe -X utf8 -m unittest discover -s tests -v
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs
# 观察已有研究并验证所有登记产物的 HTTP 下载与哈希，不启动新实验
./.venv/Scripts/python.exe -X utf8 scripts/run_research.py --run-id dd98c3f59cc34e73b7d2be3e3ec36899 --evidence evidence/research-current-runtime-check.json
# 真实本地模型验证
./.venv/Scripts/python.exe -X utf8 scripts/verify.py --live
```

真实 YOLO 测试单独设 `YOLO_RUNTIME_TEST=1`，使用公开图与其三帧视频，不打开私人摄像头。用户已确认科研页面能够打开、布局正常，并提供桌面截图；小屏幕未单独实测。历史回归和本轮实际核验分别记录在 [verification.md](docs/verification.md)。

训练输出位于 `runs/detect/coco8_baseline*`，最佳权重为 `assets/models/best.pt`。coco8 只有 4 张训练图、4 张验证图，训练证据只证明小样例管线可复现。权重和运行原始文件不进 Git；重训可恢复权重，跨设备不保证完全相同数值。公开公交车样例支持面试备用演示，不能代替摄像头现场验收。

## 目录与接口

- `src/agent/`：基础模型请求、工具校验与循环。
- `src/research/`：科研契约、持久化、控制图、注册实验、写作与 MCP。
- `src/yolo/`：训练、推理及证据归档。
- `src/web/`：三个网页、研究 API、共享视觉流。
- `scripts/`：启停与验证；`docs/`：说明和过程记录；`evidence/`：可提交的运行摘要。
- `logs/research/`：运行数据库、检查点、原始实验及论文版本，本机产物忽略提交。
- `.agents/skills/aiu-research-workbench/`：本项目技能；`configs/mcp.example.toml`：可迁移的 MCP 配置示例。

研究 API 提供能力、创建/查询任务、事件游标、取消/恢复及登记产物下载；详细契约见 [运行说明](docs/research-workbench.md)。原有 `/api/health`、`/api/chat`、`/yolo/sources`、`/yolo/status`、`/yolo/start`、`/yolo/stop`、`/yolo/stream` 仍可用；[接口文档](http://127.0.0.1:8000/docs) 由 FastAPI 生成。

## AI 使用情况与后续范围

原始骨架由豆包辅助生成；2026-10-07 至 10-09 使用 Codex 对照 PDF 修复、训练、验证和实现科研工作台。论文分析与审查另使用本机 Codex CLI；实验代码、数据划分和稿件数字由已注册程序执行及核查。此前缺乏证据的“全部完成”和旧指标已撤下，历史设计保留来源与时间。

现行 [Harness 主计划](docs/harness-plan.md) 区分已实现的固定领域流程与后续任意代码执行、深层研究质量、外部评价及投稿接入。提交者应能解释调用链、固定划分、测试集冻结、恢复账本、模型回退和科学结论的边界。仓库：[AIU-interview-2026](https://github.com/githud-yang/AIU-interview-2026)。

参考：[Ollama 工具调用](https://ollama.com/blog/tool-support)、[Ultralytics 训练](https://docs.ultralytics.com/modes/train/)、[Ultralytics 推理](https://docs.ultralytics.com/modes/predict/)。
