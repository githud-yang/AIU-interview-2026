# 前端界面

- `index.html`、`app.js`：文字冒险的显示、输入和会话UI。
- `yolo.html`、`yolo.js`：检测界面，订阅后端MJPEG图像与SSE状态。
- `research.html`、`research.js`：进阶科研界面，显示后端阶段、结果、日志与产物。
- `api.js`、`yolo-transport.js`、`research-transport.js`：HTTP命令与订阅适配，集中处理网络边界。
- `style.css`、`research.css`：外观与响应式布局。
- `research-strategy.html`：进阶研究的首批策划资料展示，不执行研究。
- `showcase.html`、`showcase.js`、`showcase.css`：适合投屏的固定连续页面，页内导航定位作品；聊天/检测直接操作、训练曲线和保存报告常驻、萤火点击后在固定iframe加载。核对资料收在页底，没有模式翻页、新标签或证据弹窗。
- `showcase-live.js`：只组装展示页的实际操作模块；`showcase-chat.js`、`showcase-yolo.js`分别组织聊天与检测UI，复用现有API/订阅客户端。生成、检测启动和查看现有画面均需用户主动操作。
- `showcase-transport.js`：展示资料、保存研究和只读预检的HTTP适配；研究示例仅查看已完成运行，不启动实验。

前端只提交命令、订阅服务和格式化显示。训练、推理、指标计算、阶段推进、密钥持久化均在后端。兼容不支持EventSource的环境时使用传输模块回退，不将轮询或请求分散到业务渲染。无需npm构建，FastAPI直接提供静态资源。
