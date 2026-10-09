# HTTP 与流接口

按功能划分路由：`chat_routes.py` 处理文字冒险，`yolo_routes.py` 提供检测控制和 MJPEG 帧流，`health_routes.py` 提供状态探测，`research_routes.py` 提供科研扩展和 SSE 事件。

路由只负责请求校验、调用服务和响应组织；计算交给 `../services/`、`../managers/` 及对应后端功能模块。统一由 `../main.py` 挂载，不单独启动。
