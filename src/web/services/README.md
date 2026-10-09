# Web 服务编排

`chat_service.py` 组织文字冒险提示词与历史消息，调用智能体生成回复；`lifecycle.py` 延迟创建科研服务，管理应用启动和退出时的资源释放。`research_stream.py` 和 `yolo_stream.py` 分别把科研事件和检测状态转换为 SSE 推送，属于传输适配。

这里不组织 UI，也不接受未经路由校验的 HTTP 请求。服务由 `../main.py` 与路由组装，模型计算仍由 `src/agent/`、`src/research/` 完成。
