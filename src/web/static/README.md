# 前端界面

- `index.html`、`app.js`：文字冒险的显示、输入和会话UI。
- `yolo.html`、`yolo.js`：检测界面，订阅后端MJPEG图像与SSE状态。
- `research.html`、`research.js`：进阶科研界面，显示后端阶段、结果、日志与产物。
- `api.js`、`yolo-transport.js`、`research-transport.js`：HTTP命令与订阅适配，集中处理网络边界。
- `style.css`、`research.css`：外观与响应式布局。
- `research-strategy.html`：进阶研究的首批策划资料展示，不执行研究。

前端只提交命令、订阅服务和格式化显示。训练、推理、指标计算、阶段推进、密钥持久化均在后端。兼容不支持EventSource的环境时使用传输模块回退，不将轮询或请求分散到业务渲染。无需npm构建，FastAPI直接提供静态资源。
