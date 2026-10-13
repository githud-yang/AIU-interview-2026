# 回归检查

从仓库根目录运行：

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs tests/test_showcase_frontend.mjs tests/test_showcase_live.mjs tests/test_showcase_navigation.mjs tests/test_showcase_research_frontend.mjs tests/test_research_workflow.mjs tests/test_research_outcomes.mjs
```

`test_agent*`检查智能体，`test_yolo*`检查视觉与证据，`test_research*`检查进阶流程、设置和前端。上述自动化回归默认不调用云端模型、不占用摄像头；真实YOLO测试需显式设置`YOLO_RUNTIME_TEST=1`，使用公开图和临时视频。SSE检查使用受控状态和断开信号，不启动真实研究。页面实际运行不同：进入YOLO区或打开独立检测页会自动开启摄像头。

`test_showcase.py`检查公开证据白名单、路径与链接隔离、HTTP响应、预检离线降级和不触发生成/推理的约束。界面布局仍需真实浏览器彩排，HTTP通过不能代替视觉验收。

`test_showcase_frontend.mjs`验证展示HTTP客户端的只读请求、非法/离线响应与关闭/超时取消，不请求真实网络。

`test_showcase_research.py`验证兼容的已完成报告接口、私有字段隔离、产物哈希失败拒绝与CSP sandbox。`test_showcase_live.mjs`验证进入YOLO自动开启摄像头、换源串行/最后意图、主动停止抑制、离开释放与外部运行保护；独立页复用同一控制器。`test_yolo_stop_guard.py`核对条件停止的原子边界；`test_yolo_demo_setup.py`核对案例安装完整性。真实动态视频双流检查仍需显式启用，不在普通单测中打开物理摄像头。

`test_research_workflow.mjs`验证节点状态、选择与视口保留、键盘、中文稿优先、按登记来源匹配产物、下载地址安全及销毁清理；不发网络。`test_research_frontend.mjs`另覆盖灵感/期刊只带入可编辑重点、跨源消息拒绝、运行中不改方案，以及BFCache返回时旧刷新不阻断新订阅。

`test_research_outcomes.mjs`核对当前中文版本、冻结评测摘要、最新完整包和登记下载边界；前端集成检查另覆盖默认成果、页内预览、SSE不抢页签与换运行清除旧链接。`test_research_artifact_preview.py`核对HTML/PNG的inline响应、HTML sandbox CSP、默认附件下载，以及路径/哈希拒绝；不创建研究或调用模型。
