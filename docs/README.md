# 记录与证据

启元的面试首入口为[统一展示台](http://127.0.0.1:8000/showcase)：固定连续页内直接操作文字冒险和YOLO，萤火点击后在本页加载；训练曲线保留，科研只使用常驻工作台。顶部八项导航定位作品；进入YOLO区自动开启摄像头，选择行人视频案例自动换源，离开释放本页创建的检测。研究和模型生成仍通过各自操作启动。建议按[演示稿](demo.md)走完6–8分钟，工程与核对资料在页底。

- [checklist.md](checklist.md)：唯一主进度清单，区分实现、运行、科学质量和实物验证。
- [structure.md](structure.md)：六条工程要求对应位置、模块边界与历史归档。
- [runtime-environment.md](runtime-environment.md)：新机配置、权重/视频准备、独立服务、摄像头权限、历史材料与排障。
- [../evidence/readme-delivery-audit-20261014.json](../evidence/readme-delivery-audit-20261014.json)：启元命名、文档遗漏、完整回归、命令及当前HTTP核对。
- [research-workbench.md](research-workbench.md)：科研工作台实际能力、启动、模型配置、MCP/技能、接口和产物。
- [progress.md](progress.md)：按时间记录工程变更，旧段落描述当时状态。
- [verification.md](verification.md)：回归、真实运行和人工页面验收及其限制。
- [wildlife_training_result.json](wildlife_training_result.json)：当前展示的原13行野生动物训练参数、10轮记录及归档位置。
- [training_result.json](training_result.json)：此前coco8通用检测实验，区别于原野生动物训练。
- [demo.md](demo.md)：从统一展示台开始的6–8分钟建议演示顺序及备用材料。
- [yinghuo-assessment.md](yinghuo-assessment.md)：萤火创意作品评估、工程补齐、源码入口与真实AI验收。
- [submission-readiness.md](submission-readiness.md)：原题逐项核对、硬件完成记录、交付收尾及自动科研剩余目标。
- [yolo-ideas-and-venues.md](yolo-ideas-and-venues.md)：三个YOLO想法、三本期刊官方要求与来源，当前为首批资料。
- [editor-inquiry-draft.md](editor-inquiry-draft.md)：编辑咨询草稿，尚未发送。
- [harness-plan.md](harness-plan.md)：现行全流程科研计划，标明固定领域已实现及未完成的扩展。
- [harness-design-v2.md](harness-design-v2.md)：历史视觉实验助手设计与三个 Harness 官方来源。
- [../evidence/research-runtime-smoke.json](../evidence/research-runtime-smoke.json)：首次真实科研贯穿运行快照。
- [../evidence/research-writer-runtime-smoke.json](../evidence/research-writer-runtime-smoke.json)：Codex CLI 分析、审查、修订的真实运行快照，12 阶段、0 次研究内人工介入。

- [../evidence/research-export-smoke.json](../evidence/research-export-smoke.json)：digits第四版讨论正文从冻结事实导出，10 数字 token 核查、旧 67 文件保留、累计 79 下载一致，新增模型请求/拟合为 0。
- [../evidence/research-mcp-smoke.json](../evidence/research-mcp-smoke.json)：MCP 真实 stdio 八工具与只读证据核查。
- [../evidence/research-settings-http-smoke.json](../evidence/research-settings-http-smoke.json)：科研论文模块DeepSeek设置入口的真实HTTP检查；该次未修改凭据，尚无真实DeepSeek论文调用证据。
- [../evidence/yinghuo-showcase-smoke.json](../evidence/yinghuo-showcase-smoke.json)：萤火独立创意作品的安装/构建/测试及5次真实DeepSeek调用；不替代科研论文模块验收。
- [../evidence/showcase-smoke.json](../evidence/showcase-smoke.json)：统一展示台页面、12份公开证据字节核验与只读预检；未进行浏览器视觉验收。
- [../evidence/showcase-stage-smoke.json](../evidence/showcase-stage-smoke.json)：固定同页操作改版的HTTP、公开证据与原始报告哈希，以及离线行为回归；未进行浏览器视觉验收。

`docs/evidence/` 为 YOLO 训练归档，根目录 `evidence/` 保存可提交的运行摘要与公开样例。完整科研原始文件、论文版本和数据库位于忽略提交的 `logs/research/`；密钥与个人授权不随证据提交。

- [../evidence/research-yolo-runtime-smoke.json](../evidence/research-yolo-runtime-smoke.json)：YOLO固定权重尺寸对比的真实12阶段运行、原始指标与306个产物下载核验。
- [../evidence/research-yolo-export-smoke.json](../evidence/research-yolo-export-smoke.json)：YOLO第三版导出复用冻结测量，旧306个文件保留、累计319下载一致，无新增模型调用或训练。

固定展示页八项导航、小屏及同页科研流程已有2026-10-11浏览器记录；2026-10-14本人确认最新自动摄像头与动态案例切换正常，见[实时换源验收](../evidence/showcase-live-sources-20261013.json)。单一科研工作台布局以HTTP结构检查留证，不能用此前截图替代该次视觉验收。萤火完整编辑/刷新持久化和备份、实际投屏及本人讲解仍单独核验。版本以最新Git记录为准；硬件按本人确认完成，通用自主科研、创新和投稿等探索目标不列为二面基础缺项。
