# 前端模块

`main.tsx` 挂载 React 并初始化本地词库，`App.tsx` 只组装路由。页面在 `routes/`，可复用展示组件在 `components/`；本地状态和存储分别在 `stores/`、`db/`。

`services/` 封装 API 任务订阅、词库缓存和备份，`data/` 提供词表，`types/` 提供类型。模型请求与密钥由根目录 `server/` 管理。
