# Netlify 部署边界

当前完整应用需要 Node 后端运行 AI 任务、保存服务端设置并推送 SSE 结果。仓库内旧 Netlify 配置和 `deploy:*` 脚本只构建、上传 `dist`，不能直接运行 `server/`。

## 本地完整运行

```powershell
npm install
npm run build
npm start
```

打开 `http://127.0.0.1:4318`。AI Key 配置在本机后端环境或应用设置中，见 [README](README.md)。

## 以后部署时要补齐

- 给 Node 后端安排支持长连接的运行环境，再确定 API 路由和前端访问方式。
- 将 API Key 配置在后端运行环境，不能使用 `VITE_DEEPSEEK_API_KEY` 或旧的 `VITE_DASHSCOPE_API_KEY`。
- 校验 HTTPS、访问控制、SSE 连接及任务异常；不能把仅供本机使用的配置接口直接公开。
- 新域名是新的浏览器存储来源；先备份，再显式导入原有随笔。

这是一份部署差距说明，不是已经完成的云端部署方案。当前不执行旧部署脚本，也不把静态页面可打开记作 AI 服务已上线。
