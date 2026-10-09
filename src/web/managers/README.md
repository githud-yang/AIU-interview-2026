# 检测任务与帧管理

`yolo_process_manager.py` 管理一个检测工作线程、来源状态、最新 JPEG 帧及停止清理。浏览器通过路由订阅共享帧；连接数量不会创建新的推理任务。

图像来源和检测能力来自 `src/yolo/`，HTTP 接口位于 `../routes/yolo_routes.py`。管理器由 Web 应用组装，无独立启动命令。
