# 前端界面

- `index.html`、`app.js`：文字冒险的显示、输入和会话UI。
- `yolo.html`、`yolo.js`：检测界面，订阅后端MJPEG图像与SSE状态。
- `research.html`、`research.js`：进阶科研界面，显示后端阶段、结果、日志与产物。
- `api.js`、`yolo-transport.js`、`research-transport.js`：HTTP命令与订阅适配，集中处理网络边界。
- `style.css`、`research.css`：外观与响应式布局。
- `research-strategy.html`：进阶研究的首批策划资料展示，不执行研究。
- `showcase.html`、`showcase.js`、`showcase.css`：二面总览与逐项演示，打开作品、查看公开证据和讲解提示；支持上一项/下一项、方向键及用户主动全屏。
- `showcase-transport.js`：展示资料与只读预检的HTTP适配，不启动模型、研究或摄像头；只在进入页面/手动刷新时请求。

前端只提交命令、订阅服务和格式化显示。训练、推理、指标计算、阶段推进、密钥持久化均在后端。兼容不支持EventSource的环境时使用传输模块回退，不将轮询或请求分散到业务渲染。无需npm构建，FastAPI直接提供静态资源。
