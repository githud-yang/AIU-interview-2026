# 开发工具

开发启动脚本组装 Node API 与 Vite 进程，具体功能仍在各自模块。`build-gaokao3500.mjs` 将 CSV 转为前端词表 JSON，可通过 `npm run build:gaokao3500` 调用。

`netlify-one-click.ps1` 与 `netlify-automated.ps1` 是旧静态发布工具，只上传前端产物，不能部署当前 Node API。保留供历史参考，本次未执行；完整运行使用根目录 README 中的命令。
