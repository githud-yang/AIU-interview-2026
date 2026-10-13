# HTTP 与流接口

按功能划分路由：`chat_routes.py` 处理文字冒险，`yolo_routes.py` 提供检测控制和 MJPEG 帧流，`health_routes.py` 提供状态探测，`research_routes.py` 提供科研扩展和 SSE 事件。

路由只负责请求校验、调用服务和响应组织；计算交给 `../services/`、`../managers/` 及对应后端功能模块。统一由 `../main.py` 挂载，不单独启动。

科研登记文件默认作为附件下载；`/api/research/runs/{run_id}/artifacts/{artifact_id}?preview=1`只允许已通过路径/哈希核验的HTML与PNG页内显示。HTML使用sandbox CSP，预览与下载均禁止类型嗅探并重新验证缓存，不接受任意文件路径。

`showcase_routes.py`提供`/showcase`、`/api/showcase`、`/api/showcase/preflight`与固定ID的公开证据读取；`/api/showcase/research`及其`files/{id}`只展示指定已完成研究的四类已登记结果。文件接口不接受任意路径，不暴露配置、私人摄像头或完整运行目录；HTML预览通过CSP sandbox禁止脚本。
