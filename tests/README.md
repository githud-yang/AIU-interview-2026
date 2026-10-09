# 回归检查

从仓库根目录运行：

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs tests/test_showcase_frontend.mjs
```

`test_agent*`检查智能体，`test_yolo*`检查视觉与证据，`test_research*`检查进阶流程、设置和前端。默认不调用云端模型，不打开私人摄像头；真实YOLO测试需显式设置`YOLO_RUNTIME_TEST=1`。SSE检查使用受控状态和断开信号，不启动真实研究。

`test_showcase.py`检查公开证据白名单、路径与链接隔离、HTTP响应、预检离线降级和不触发生成/推理的约束。界面布局仍需真实浏览器彩排，HTTP通过不能代替视觉验收。

`test_showcase_frontend.mjs`验证展示HTTP客户端的只读请求、非法/离线响应与关闭/超时取消，不请求真实网络。
