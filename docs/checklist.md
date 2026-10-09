# 主进度清单（2026-10-10）

范围：按 PDF 修复基础项目，并实现用户要求的自动科研流程。设计、软件真实运行、科学质量、外部投稿和实物验证分别记录。现行计划为 [harness-plan.md](harness-plan.md)，操作入口为 [research-workbench.md](research-workbench.md)。按原题核对及剩余事项见 [submission-readiness.md](submission-readiness.md)。

- [x] ✓ PDF 与既有代码核对：基础、进阶及无关练习分开。来源：根目录 PDF、README。
- [x] ✓ 本地智能体、文字冒险与 YOLO 修复、30 轮训练证据整理。来源：training_result.json、verification.md、docs/evidence/yolo-runtime-smoke.json。
- [x] ✓ Harness 来源与目标核查：Pi、Deep Agents、OpenHands SDK 及三个自动科研系统官方资料，现行计划涵盖 12 阶段。来源：harness-plan.md、历史 harness-design-v2.md。
- [x] ✓ 科研固定领域基础接入：独立 `.venv`、注册的 digits 高斯增强 runner、统一输入/阶段输出/产物契约。来源：requirements-research.txt、src/research/contracts.py、domain.py。
- [x] ✓ 文献到实验：Crossref/arXiv 检索、公开 arXiv PDF 获取与文本解析、范围标记、问题与冻结协议、固定分层划分、验证集候选选择及多种子最终评测。来源：src/research/、两份 research-runtime 证据；公式/表格不声称已可靠理解。
- [x] ✓ 实验到论文：原始 CSV 重算指标和图表，自动生成 Markdown/HTML/PDF/TeX 源码及复现包；审查后保留原稿和第二版。来源：最新运行的 manuscript/、manuscript_v2/、review.json。
- [x] ✓ 真正接入论文模型：已登录的 Codex CLI 完成分析、审查、修订三个真实调用；DeepSeek/OpenAI 适配已实现但没有真实密钥调用证据。来源：最新运行 writer/005-analysis、006-review、007-analysis_revision 日志。
- [x] ✓ 可靠执行机制：LangGraph SQLite 检查点、应用幂等账本、单 worker 进程锁、取消、重启恢复、实际耗时/模型请求/拟合累计与哈希校验。来源：runtime.py、store.py、相关回归；每个具体故障是否真实注入以 verification.md 为准。
- [x] ✓ 两次真实贯穿运行：12 阶段均完成，最新 454.031 秒、7 次模型请求、18 次拟合、55 个登记产物全部下载哈希一致，研究内 0 次人工介入、1 次自动恢复。来源：evidence/research-runtime-smoke.json、evidence/research-writer-runtime-smoke.json。
- [x] ✓ 桌面页面人工验收：用户确认 `/research` 能打开、布局正常并提供截图。来源：2026-10-08 用户回复及截图；最新资源选项折叠改版已有前端回归，尚无浏览器视觉实测。
- [ ] 最新资源选项、DeepSeek 设置与小屏浏览器实际验收：尚未独立完成，前端 27 项模拟测试和响应式 CSS 不能替代。
- [x] ✓ MCP 八工具真实连接：独立环境完成 stdio 握手、默认资源空值读取、任务列表、非法 ID 拒绝与登记产物哈希核查；项目配置/全局技能安装，新会话使用。来源：evidence/research-mcp-smoke.json。
- [x] ✓ DeepSeek设置轮回归：Python 117项，115通过、2跳过；Node 27项通过。最新YOLO扩展回归另记。
- [x] ✓ DeepSeek 网页 Key 接口：密码输入、官方模型连接测试、验证后原子保存和论文模块即时切换；失败回滚、同源校验、运行中禁止保存、空 Key 复用和不回显已覆盖。来源：settings.py、research_routes.py、14 项设置回归及 evidence/research-settings-http-smoke.json；未使用真实 Key。
- [ ] DeepSeek 真实云端论文调用：需要用户在网页填写自己的 Key；连接测试和受控适配回归不替代实际分析、审查及修订调用。
- [x] ✓ 累计资源限额体验优化：契约、页面与 MCP 默认不设累计时长/调用/拟合限额，用户可选高级限制；实际计数和单次请求超时保留。来源：contracts.py、research.html/js、research-mcp-smoke.json；最终回归另记。
- [x] ✓ 论文讨论正文最新第四版：已有 Codex 分析写入正文，修复句末数字识别后 10 个数字 token 全部核查、未知数字为 0；旧 67 个产物未覆盖，累计 79 个登记文件下载哈希一致，新增模型调用/拟合均 0。来源：evidence/research-export-smoke.json；数字成员一致不代表解释语义已被外部验证。
- [x] ✓ PDF 第三版全页视觉与后台启停：三页均已渲染读图，未见裁切/乱码，Unicode 参考文献正常；stop→start 实际成功且 HTTP 接口可达。来源：本轮渲染验收、启停控制输出和服务记录。
- [x] ✓ 第四版 PDF 最终视觉复核：最新文件已独立渲染三页并逐页读图，正文、表格、图及参考文献可读，未见裁切或乱码；不以第三版视觉代替。
- [ ] 任意生成代码的受控沙箱、通用领域适配、作业级 GPU/OOM 自动修复与完整新环境独立复现。当前固定 runner 和只读写作 CLI 不替代这些能力。
- [ ] 科学创新与外部质量：当前实验是已知增强方法的工作流样例，没有充分创新核查、外部专家评价或真实评审。
- [ ] 指定渠道真实投稿：已生成材料，但作者、渠道与账号未配置，状态为 not_submitted。
- [ ] 现场摄像头演示补验收：历史画面全黑，尚未重新验收；已有公开图/本地视频实时软件运行证据，原题没有指定必须使用摄像头。
- [x] ✓ 硬件任务：用户于2026-10-10确认已完成。本轮未重新实物验收，不推定未说明的PID或板端模型层级。
- [x] ✓ 本轮实现和证据提交、推送：实现提交 `45a9572` 已实际推送至 origin/main；Key、本机环境、数据库和原始运行文件未提交。

- [x] ✓ YOLO研究任务：固定已有权重、FP32/batch1、320/480/640，选择/评测拆分、真实mAP和原始延迟样本；没有新增训练。
- [x] ✓ YOLO真实12阶段运行：`bd8c2a7ccaff4ae4b3be7f7e6fa13c43`完成，202.0秒、6次模型请求、5个评测作业、0次训练、306个登记产物下载哈希一致；研究内0人工介入、3次自动恢复包含开发修复，不代表无人调试。来源：../evidence/research-yolo-runtime-smoke.json。
- [x] ✓ YOLO负结果保留：选参选择480，第二拆分未复现速度优势；COCO128可能与预训练重叠，不算独立泛化测试。
- [x] ✓ 具体任务与策划入口：问题/数据/比较/指标/输出说明来自后端；/research/strategy有三个想法、三本期刊官方要求和编辑咨询草稿，未发送信件。
- [x] ✓ YOLO扩展阶段回归：Python128项，126通过、2跳过；Node31项通过，新页面尚无浏览器视觉验收。源码版本冻结保护另记。
- [ ] 灵感与期刊背调自动化：当前是首批策划资料，未实现自动全文差异矩阵、候选淘汰和期刊要求进入协议。
- [ ] 便携冻结重放与新环境独立复现：当前归档不提供重定位执行入口，不把新的项目测量称为原实验重放。
- [ ] 本人面试彩排：解释实现思路和证据范围，展示已完成硬件；演示提纲已同步。
- [x] ✓ 本轮YOLO与策划变更提交、推送：实现与结构整理提交0e0e749已推送origin/main。

下一项：本人完成二面彩排；科研后续优先推进灵感与期刊背调接入。真实DeepSeek调用需在网页配置Key后核查，不阻塞基础交付。

## 2026-10-10：按六条工程要求整理

- [x] ✓ 面试分类：基础agent/yolo/web、创意文字冒险、进阶research、资料/证据、历史archive分别说明；硬件按本人确认完成。
- [x] ✓ 主入口仅组装：Web生命周期与健康检查拆出，CLI交互循环从模型核心拆出，保留旧CLI兼容入口。
- [x] ✓ 无关历史原件归档：exam1、exam2、旧内存Harness移入archive/legacy，不参与启动。
- [x] ✓ 功能目录README与顶部说明：活跃src功能目录缺README为0，Python缺docstring为0；JS/CSS/HTML/脚本职责说明已补。
- [x] ✓ 前后端订阅解耦：科研SSE快照/差量/游标，视觉SSE状态与MJPEG图像，HTTP/订阅封装到独立transport。
- [x] ✓ 最终回归：Python143项，141通过、2跳过；Node39项通过。实际HTTP/SSE快照、游标重连与断开检查通过，无新增模型/研究调用。来源：../evidence/structure-and-sse-smoke.json。
- [x] ✓ YOLO第三版导出：旧306产物保留，累计319下载哈希一致，新增模型调用和训练为0；收紧便携复现表述，补样本排除限制，未重跑测量。
- [ ] 最新订阅改版浏览器视觉实测：HTTP/Node不冒充视觉检查。
- [x] ✓ 本轮结构整理与新功能提交推送：0e0e749实际推送成功；归档文件为100%重命名，凭据、权重和运行目录未提交。

- [x] ✓ 整理后真实YOLO公开图双流/三帧视频复核1项通过，无私人摄像头；第三版PDF3页全页渲染读图通过。

## 2026-10-10：萤火创意作品候选

- [x] ✓ 原项目快速评估与分类：归入第五项创意作品候选，源码保留原路径；类型检查、Vite构建通过，ESLint0错误/4警告。
- [x] ✓ 评估已纳入README与交付核对：见yinghuo-assessment.md，未将已有API代码当作真实AI运行验收。
- [x] ✓ 萤火软件收尾：AI/Key后端化、HTTP命令/SSE订阅、设置测试/保存、错误重试、功能README和顶部说明、50篇虚构演示及数据隔离完成。
- [x] ✓ 萤火验证：类型/构建/Lint通过（0错0警告）；47项中46通过/1文件符号链接权限跳过。独立展示快照实际npm ci、构建、测试和Lint通过。
- [x] ✓ 萤火真实云端：用户在4318页面保存Key后，虚构随笔完成翻译/金句、单句、查词、画像、带历史对话5次实际DeepSeek请求成功。来源：../evidence/yinghuo-showcase-smoke.json；不代表科研论文的DeepSeek适配已真实验收。
- [x] ✓ 萤火源码纳入二面：showcases/yinghuo为可运行快照，逐文件SHA256与来源记录；无密钥/私人笔记/构建产物，原项目保留。
- [ ] 萤火浏览器完整验收与本人彩排：用户已成功操作Key保存；完整编辑/刷新持久化、响应式视觉与备份下载尚未单独实测。
- [x] ✓ 萤火实现与证据已提交并推送：401db00实际推送origin/main；快照91个源码文件哈希与Git索引一致，密钥、个人数据和运行目录未提交。
