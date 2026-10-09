# Web 接口与页面

`main.py` 只创建应用、挂载资源和组装路由。`routes/` 校验请求并提供 HTTP、SSE 与视频帧流；`services/` 编排聊天和应用生命周期；`managers/` 管理检测线程和共享帧。模型、检测和科研计算分别位于 `src/agent/`、`src/yolo/`、`src/research/`。

`static/` 负责界面、用户操作和订阅结果，不执行模型推理、训练或科研指标计算。前后端通过 JSON API、SSE 事件和 MJPEG 帧流连接；接口实现位于 `routes/`。

在项目根目录启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn src.web.main:app --host 127.0.0.1 --port 8000
```

基础页面为 `/`（文字冒险）和 `/yolo`（视觉检测）；`/research` 是用户追加的科研扩展。缺少可选科研运行依赖时，基础功能可启动，科研 API 明确报告不可用。配置和环境准备见根目录 [README](../../README.md)。
