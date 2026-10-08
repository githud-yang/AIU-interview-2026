# 科研工作台操作与实际能力

当前实现日期：2026-10-09。网页为 [http://127.0.0.1:8000/research](http://127.0.0.1:8000/research)。完整目标与未接入环节见 [harness-plan.md](harness-plan.md)，实际验收见 [verification.md](verification.md)。

## 本轮已经能做什么

一次启动自动经过 12 个阶段：文献发现、全文获取与阅读、选题与反证、实验设计、数据准备、基线复现、方法实现、候选实验、复验与消融、分析与论文、核查与修改、投稿材料。

当前唯一注册领域为 `digits_robustness`。它使用 sklearn 自带的 1797 个 8×8 手写数字样本，在固定分类实验中比较高斯训练增强与无增强对照。模型提出经 schema 校验的声明式配方，程序只执行登记的 Logistic Regression 或 Random Forest；不执行模型任意生成的 Python、shell 或外部仓库代码。

研究输入可表达目标，具体实验能力仍受已实现领域限制。这个流程样例验证模块衔接、真实实验与稿件生成；高斯增强是已知方法，工作流完成不等于发现新算法。

## 启动、停止和数据位置

本机 `.venv` 基于既有 YOLO Python 环境创建，科研依赖装在该环境中；`.venv-mcp` 单独管理 MCP SDK，避免影响网页环境的 Pydantic 版本。

```powershell
# 首次准备独立科研环境（已有环境可跳过）
python -m venv .venv
./.venv/Scripts/python.exe -X utf8 -m pip install -r requirements-research.txt
# 后台运行，不弹出终端窗口
./scripts/start.ps1 -Background
# 停止脚本记录且核对身份后的本项目服务
./scripts/stop.ps1
# 前台运行；Ctrl+C 停止
./scripts/start.ps1
```

脚本优先使用项目 `.venv`。用 `-Python <实际解释器路径>` 或 `-Port 8001` 可以覆盖。背景服务身份记录在 `logs/web-server.json`，控制台输出在 `logs/web-stdout.log`、`logs/web-stderr.log`。科研依赖缺失时基础网页仍可启动，科研能力接口明确报告不可用。

研究目录为 `logs/research/`：

| 位置 | 内容 |
| --- | --- |
| 应用 SQLite 数据库 | 任务、阶段状态、事件、幂等操作、资源记录和产物登记 |
| `graph.sqlite3` | LangGraph 持久检查点 |
| `worker.lock` | 同一运行根目录的单 worker 进程锁 |
| `runs/<run_id>/literature/` | 来源元数据、检索响应、可获得的公开 PDF 与文本 |
| `runs/<run_id>/experiments/` | 固定 runner 快照、协议、划分、环境、CSV、预测、图表与哈希 |
| `runs/<run_id>/model/`、`writer/` | 模型原始响应、校验、实际调用与故障记录 |
| `runs/<run_id>/manuscript/`、`manuscript_v2/`、`manuscript_v3/`、`manuscript_v4/` | 原稿、审查修订与讨论正文/数字审计导出版，保留版本 |
| `runs/<run_id>/research_bundle.zip` | 当时完整研究材料与审计记录；后续版本另行登记 |

这些完整原始文件忽略 Git 提交，运行摘要保存在根目录 `evidence/`。不要通过修改数据库把失败改成成功，或覆盖已完成的阶段产物。

## 默认持续执行与可选资源限额

用户只需提供研究目标并启动；默认没有累计时长、模型请求次数或拟合次数停止上限。本轮按已登记的研究流程执行到结束，不是无限创造新实验。页面显示已耗时、实际调用和拟合，帮助理解执行情况。

高级资源限额由用户主动选择。API 的 `budget.max_seconds`、`budget.model_calls`、`budget.max_trials` 可以留空或设 `null` 表示不设累计上限；明确设置数值时执行相应限额。恢复保留已经消耗的记录，不清零。当前标准三种子、两个增强候选全过程通常需要 18 次真实拟合；单候选最少需要 15 次，这来自实际实验组成，而不是论文完成所需的通用次数。

每次 HTTP 请求和写作子进程仍有独立超时，可恢复故障会重试或采用记录在案的回退。该超时控制单次卡住的操作，和整项研究的停止条件分开。取消按钮始终保留。原始运行证据里的 1200 秒、12 次模型、18 次拟合是旧配置快照，不能理解为当前默认规则。

## 论文模型如何选择

网页展开“论文模型设置”，输入 DeepSeek Key 和模型，点击“测试连接”，再点击“保存并启用”。连接测试只读取官方 `/models`，不生成论文，也不保存 Key；保存会再次验证可用模型，成功后写入忽略提交的 `configs/.env` 并立即切换论文分析、审查和修订。验证或文件保存失败保留旧配置。已经配置 Key 时，输入留空可以复用；界面只显示是否配置，不回显 Key，也不写入浏览器存储。进行中的研究或导出暂时禁止保存，避免同一任务中途换模型。测试通过仅证明鉴权和模型可见，真实论文生成仍以实际调用记录为准。

Key 只从本机同源页面提交到本机服务，再用于官方 `https://api.deepseek.com/v1`；它作为本机配置明文保存在 `.env`，不进入 Git、公开接口或研究证据。需要 Key 时在网页填写，不在聊天中发送。实际论文模型可从连接测试返回的可用列表选择。当前尚未填入真实 DeepSeek Key，不能声称云端调用已验收。

`configs/.env.example` 包含公开示例，手动编辑配置文件或环境变量后重启服务；网页保存无需重启。控制模型通常仍使用 Ollama `qwen2.5:7b`，网页配置只切换论文模块，论文分析、审查及修订可单独选 provider：

| `RESEARCH_WRITER_PROVIDER` | 选择与条件 | 真实验证状态 |
| --- | --- | --- |
| `auto` | 已配置的 DeepSeek → 已配置且指定模型的 OpenAI → 已登录的 Codex CLI → 控制模型 | 本机选择 Codex，实际三个论文角色调用成功 |
| `codex` | 使用已有 CLI 与本机登录，可用 `RESEARCH_WRITER_MODEL` 显式选择其支持的模型 | 真实分析、审查和修订成功 |
| `deepseek` | 网页设置 Key 和模型，或设置 `DEEPSEEK_API_KEY` 与论文模型名 | 设置接口、即时切换及适配回归通过，尚无真实密钥调用证据 |
| `openai` | 设置 `OPENAI_API_KEY` 与明确可用的 `OPENAI_MODEL`，使用 Responses API | 适配已实现，尚无真实密钥调用证据 |
| `inherit` | 使用控制模型及其配置 | 首次全 Ollama 贯穿运行已完成，部分角色回退 |

Codex CLI 是另一个非交互任务，使用现有登录；没有把当前聊天的模型或私有 API 地址直接挂进网页。CLI 在服务器拥有的工作目录中以只读执行，不启用 shell 工具、子智能体、hooks 或 plugins；输入是已记录的事实与审查材料，输出需通过 JSON schema。既有登录可达不代表配额无限。失败原因、重试和本地回退全部写入运行记录，`mixed_with_recorded_fallback` 表示某个角色使用过回退。

最新真实运行的三个 Codex 写作角色均成功，混合状态来自前面的控制模型阶段，而非这三个写作调用失败。不要将自动回退的运行声称为所有角色都由同一 provider 完成。

官方说明：[Codex 非交互模式](https://learn.chatgpt.com/docs/non-interactive-mode)、[OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)、[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 科学证据与稿件版本

数据采用一次固定且共享的 60/20/20 分层划分，划分随机种子为 2026/2027。模型、增强和噪声随机种子为 13/37/73；同一最终测试样本不会出现在任何种子的训练或验证集合里。候选选择只看验证集，冻结选定配置之后才开启最终测试。

每次模型拟合前登记计数，保留失败与部分结果。标准流程为基线 3 次、两个候选及配对对照的验证搜索 9 次、选定方法和对照的最终评测 6 次，总计 18 次。基线与“去掉增强”消融共享同一对照，不能看作两个独立复验。增强增加训练样本，记录拟合时长与样本数，不能宣称等计算预算的普遍优势。

论文摘要、数字、表格和图表从原始 CSV 重算并校验产物哈希。模型解释与原始回复保留，讨论应通过数字一致性检查；这只能检查已记录数值，不证明解释本身符合领域知识。原稿和审查后修订分别保存。最新第四版从已有 Codex 分析生成讨论正文，修复句末数字识别后 10 个数字 token 全部核查、未知数字为 0；此前稿件和旧 67 个产物保持原哈希，累计 79 个登记文件下载一致，新增模型请求/拟合均为 0。证据：[research-export-smoke.json](../evidence/research-export-smoke.json)。只改论证和排版时复用冻结测量，不重跑实验；看过最终测试后再修改方法，需要新的独立评测，不能靠重复同一划分恢复确认性资格。

最新已完成运行 `dd98c3f59cc34e73b7d2be3e3ec36899` 的结果：

| 方法 | 干净准确率 | 噪声准确率 |
| --- | --- | --- |
| 无增强对照 | 97.5000% | 37.6852% |
| 选定高斯增强 | 95.1852% | 87.7778% |

噪声提高约 50.09 个百分点，干净降低约 2.31 个百分点。种子标准差描述随机波动，不是独立样本置信区间。这是小数据、单种合成噪声和有限搜索的局部实验，不支持通用鲁棒性或创新结论。

PDF 由 ReportLab 生成，HTML 内嵌图表，可独立查看。TeX 是源码导出，未声称经过 TeX 编译。研究包含稿件、实验、源信息、日志与 SHA256 清单。当前投稿状态明确是 `not_submitted`，没有具体渠道、作者信息或提交回执。

## 文献覆盖

当前接入 Crossref 与 arXiv，保存原始检索响应、查询和获取状态，去重时优先保留有公开全文入口的记录。只实现 arXiv 公开 PDF 下载，Crossref 元数据不意味着已经获得出版商全文。

下载后用 pypdf 提取文本，按题目/摘要与数字、手写识别、视觉相关度筛选全文阅读对象。最新运行成功解析 2 篇公开全文，其余明确标记范围。纯文本提取不能保证公式、表格、图和版式被正确理解；付费全文、OCR/专业解析器以及穷尽式创新检索尚未接入。

## API 与幂等

服务默认只监听 `127.0.0.1`。创建请求使用稳定 `request_id`：网络重试保持 ID 和完整请求内容一致。同 ID、同内容返回已有任务；同 ID、不同内容返回 409。同一根目录只允许一个活动研究，防止重复执行和恢复冲突。

| 接口 | 用途 |
| --- | --- |
| `GET /api/research/capabilities` | 实际模型、写作 provider、执行方式和注册领域 |
| `GET /api/research/writer-settings` | 当前论文 provider、模型、Key 是否配置与可编辑状态，绝不返回 Key |
| `POST /api/research/writer-settings/test` | JSON `{ "api_key": "本机输入", "model": "可用模型 ID" }`，只验证官方模型列表 |
| `PUT /api/research/writer-settings` | 同样的 JSON，验证后原子保存并立即启用；已配置时 `api_key: null` 可复用 |
| `GET /api/research/runs` | 持久任务列表 |
| `POST /api/research/runs` | 新建已授权研究，返回 202 |
| `GET /api/research/runs/{run_id}` | 状态、阶段、记录与产物 |
| `GET /api/research/runs/{run_id}/events?after_seq=0` | 游标读取后续事件，复用 `last_seq` |
| `POST /api/research/runs/{run_id}/cancel` | 请求取消并保留证据 |
| `POST /api/research/runs/{run_id}/resume` | 恢复失败或中断任务，累计记录不清零 |
| `POST /api/research/runs/{run_id}/export` | 从完成任务的冻结结果生成新稿件/材料版本，不重新拟合或请求模型 |
| `GET /api/research/runs/{run_id}/artifacts/{artifact_id}` | 下载服务器登记并校验哈希的文件 |

默认创建请求：

```json
{
  "goal": "Study Gaussian augmentation for digit classification and report its clean accuracy trade-off.",
  "domain": "digits_robustness",
  "mode": "autonomous",
  "request_id": "stable-user-study-001"
}
```

取消、恢复必须引用实际服务器任务 ID。恢复请求省略 body 或 `{ "initiator": "user" }` 记录人工恢复；智能体传 `{ "initiator": "agent" }` 记入自动恢复，不混算人工介入。重启自动恢复以前正在执行的任务，已取消任务不自行重开。证据完整性失败不能靠反复恢复绕过。

观察已有任务并核查下载：

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/run_research.py --run-id dd98c3f59cc34e73b7d2be3e3ec36899 --evidence evidence/research-current-runtime-check.json
```

生成新的稿件版本时使用下列命令；它会登记一个新版本并保留旧文件，而不是重新运行实验：

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/export_research.py dd98c3f59cc34e73b7d2be3e3ec36899
```

不带 `--run-id` 的 run_research.py 会开始新的研究。该脚本使用与网页相同的 API，不在后台绕过阶段状态直接伪造产物。

## MCP 与可复用技能

MCP 只提供工作台 API 的八个工具：`research_capabilities`、`research_list_runs`、`research_get_run`、`research_events`、`research_start`、`research_cancel`、`research_resume`、`research_artifact`。接口限制为本机 HTTP，文件只接受服务器发出的任务与产物 ID，没有任意文件读写或 shell 工具。

```powershell
python -m venv .venv-mcp
./.venv-mcp/Scripts/python.exe -X utf8 -m pip install -r requirements-mcp.txt
# 真实 stdio 握手、工具读取和产物下载核验
./.venv-mcp/Scripts/python.exe -X utf8 scripts/verify_research_mcp.py
```

已安装 MCP SDK `2.3.0`、httpx `0.28.1`。项目 `.codex/config.toml` 保存本机绝对路径配置且忽略 Git，公开可迁移示例为 [configs/mcp.example.toml](../configs/mcp.example.toml)。配置为项目作用域，其他机器需替换解释器和仓库路径。新会话加载后可连接；不能声称当前对话已经热注入了新工具。配置格式见 [官方 Codex MCP 说明](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。

技能源文件为 [.agents/skills/aiu-research-workbench/SKILL.md](../.agents/skills/aiu-research-workbench/SKILL.md)，另已安装到本机 `C:/Users/lixia/.codex/skills/aiu-research-workbench/SKILL.md`，供新会话发现。它要求先查既有任务、保持 request ID、记录恢复、核查数字与来源范围。MCP 未连接时可直接用同一 API，避免让用户手工搬运结果。

MCP 已完成真实 stdio 握手与八工具列出，并验证默认资源限额为空、读取任务、非法 ID 拒绝及登记产物 SHA256。来源：[research-mcp-smoke.json](../evidence/research-mcp-smoke.json)。这次只读核验不再次启动研究；新增版本的最终回归状态见 [verification.md](verification.md)。
