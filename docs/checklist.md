# 主进度清单（2026-10-08）

范围：按 PDF 修复基础项目和现有原型，优化演示，交付 Harness 实施计划。Harness 完整实现单独按计划推进，不把计划当作实现。

- [x] ✓ 新一轮 Harness 调研：核对 Pi、Deep Agents、OpenHands SDK 三个官方方案及源码快照，形成取长补短的新版设计。来源：harness-design-v2.md。设计已交付，依赖安装与实现验收未执行。

- [x] ✓ 读取 PDF 与现有代码，区分基础、进阶及无关历史练习。来源：PDF、README。
- [x] ✓ 上次真实训练 30 轮并保留指标。来源：training_result.json 与其 evidence_dir 中的真实 CSV。
- [x] ✓ 智能体参数校验、调用数量/轮次限制、上下文预算、响应异常和健康检查已修复；12 项核心/网页测试通过，真实模型计算和游戏 API 已通过。来源：tests/test_agent.py、scripts/verify.py --live。
- [x] ✓ YOLO 状态/启停/异常释放、公开样例及本地视频、训练归档完成；18项离线测试与真实HTTP双流、停止、视频结束通过。来源：tests/test_yolo*.py、evidence/yolo-runtime-smoke.json。
- [x] ✓ 网页状态、重开/会话保存、重试、防重复提交、来源与网络错误处理已实现；Node语法与4项可复现模拟状态检查通过。来源：src/web/static/。
- [ ] 浏览器可视布局与小屏实测：自动审批拦截打开Chrome新标签页，当前URL无法可靠确定；停止UI操作，未计通过。
- [x] ✓ Harness 计划：固定 Pi 官方参考提交，明确六阶段、接口、存储、取消与恢复验收。来源：harness-plan.md。计划已交付，功能实施未计完成。
- [x] ✓ README、演示步骤、工程日志与验证记录同步；删去经哈希验证一致的重复证据。
- [x] ✓ 软件测试与真实演示：30项Python离线测试、4项前端模拟测试通过；真实模型和YOLO运行测试另行通过。来源：verification.md、tests/、evidence/。
- [x] ✓ 代码、证据和 Harness 计划已提交并推送原 GitHub main；实现提交 a557d5f。来源：Git实际推送结果，后续同步状态可用 git status 核验。
- [ ] 用户现场打开摄像头遮挡/隐私开关后完成物体识别演示。当前历史证据为全黑帧，软件无法代替这个实物验证。
- [ ] 单片机进阶：未提供硬件，不虚构点灯或 PID 成果。

下一项：新版 Harness 设计已供审阅；后续实现从 harness-design-v2.md 的阶段 A 起。现场摄像头与浏览器可视验证仍独立待完成。
