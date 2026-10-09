# Web 服务编排

`chat_service.py` 组织文字冒险提示词与历史消息，调用智能体生成回复；`lifecycle.py` 延迟创建科研服务，管理应用启动和退出时的资源释放。`research_stream.py` 和 `yolo_stream.py` 分别把科研事件和检测状态转换为 SSE 推送，属于传输适配。

这里不组织 UI，也不接受未经路由校验的 HTTP 请求。服务由 `../main.py` 与路由组装，模型计算仍由 `src/agent/`、`src/research/` 完成。

`showcase_service.py` 组织二面展示顺序、交付事实和固定公开证据白名单。只读预检查看本地模型列表、权重文件和本机服务健康状态，不生成模型回复、调用云端AI或启动检测/研究。

`showcase_research.py`读取指定已完成YOLO示例的简明指标，按固定种类选取登记报告、图、CSV和PDF；复用原始SHA256核验。缺少本机运行时显示已有归档摘要，不重跑研究，也不扩展为任意目录预览。
