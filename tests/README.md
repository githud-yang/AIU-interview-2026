# 回归检查

从仓库根目录运行：

```powershell
./.venv/Scripts/python.exe -X utf8 scripts/verify.py
node --test tests/test_frontend.mjs tests/test_research_frontend.mjs
```

`test_agent*`检查智能体，`test_yolo*`检查视觉与证据，`test_research*`检查进阶流程、设置和前端。默认不调用云端模型，不打开私人摄像头；真实YOLO测试需显式设置`YOLO_RUNTIME_TEST=1`。SSE检查使用受控状态和断开信号，不启动真实研究。
