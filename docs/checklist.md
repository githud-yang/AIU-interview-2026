# 主进度清单（2026-10-09）

范围：按 PDF 修复基础项目，并实现用户要求的自动科研流程。设计、软件真实运行、科学质量、外部投稿和实物验证分别记录。现行计划为 [harness-plan.md](harness-plan.md)，操作入口为 [research-workbench.md](research-workbench.md)。

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
- [x] ✓ 本轮最终回归：Python 共 117 项，115 通过、2 跳过（Windows 符号链接权限、真实 YOLO 默认需显式启用）；Node 27 项通过。verify.py 使用临时研究目录，避免与运行中的网页争用同一 worker。来源：tests/、verification.md；不是 117 项全部实际执行通过。
- [x] ✓ DeepSeek 网页 Key 接口：密码输入、官方模型连接测试、验证后原子保存和论文模块即时切换；失败回滚、同源校验、运行中禁止保存、空 Key 复用和不回显已覆盖。来源：settings.py、research_routes.py、14 项设置回归及 evidence/research-settings-http-smoke.json；未使用真实 Key。
- [ ] DeepSeek 真实云端论文调用：需要用户在网页填写自己的 Key；连接测试和受控适配回归不替代实际分析、审查及修订调用。
- [x] ✓ 累计资源限额体验优化：契约、页面与 MCP 默认不设累计时长/调用/拟合限额，用户可选高级限制；实际计数和单次请求超时保留。来源：contracts.py、research.html/js、research-mcp-smoke.json；最终回归另记。
- [x] ✓ 论文讨论正文最新第四版：已有 Codex 分析写入正文，修复句末数字识别后 10 个数字 token 全部核查、未知数字为 0；旧 67 个产物未覆盖，累计 79 个登记文件下载哈希一致，新增模型调用/拟合均 0。来源：evidence/research-export-smoke.json；数字成员一致不代表解释语义已被外部验证。
- [x] ✓ PDF 第三版全页视觉与后台启停：三页均已渲染读图，未见裁切/乱码，Unicode 参考文献正常；stop→start 实际成功且 HTTP 接口可达。来源：本轮渲染验收、启停控制输出和服务记录。
- [x] ✓ 第四版 PDF 最终视觉复核：最新文件已独立渲染三页并逐页读图，正文、表格、图及参考文献可读，未见裁切或乱码；不以第三版视觉代替。
- [ ] 任意生成代码的受控沙箱、通用领域适配、作业级 GPU/OOM 自动修复与完整新环境独立复现。当前固定 runner 和只读写作 CLI 不替代这些能力。
- [ ] 科学创新与外部质量：当前实验是已知增强方法的工作流样例，没有充分创新核查、外部专家评价或真实评审。
- [ ] 指定渠道真实投稿：已生成材料，但作者、渠道与账号未配置，状态为 not_submitted。
- [ ] 现场摄像头真实物体识别：历史画面全黑，需实际开镜头/隐私开关核验。
- [ ] 单片机进阶：没有硬件，不虚构点灯或 PID 成果。
- [x] ✓ 本轮实现和证据提交、推送：实现提交 `45a9572` 已实际推送至 origin/main；Key、本机环境、数据库和原始运行文件未提交。

下一项：用户在网页配置 Key 后核查真实 DeepSeek 论文调用。任意代码研究、外部质量与实际投稿继续按计划逐项推进，不能用首次工作流完成代替。
