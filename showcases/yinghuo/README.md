# 萤火

中文随笔与英语表达练习应用：编辑和备份随笔，按需生成英文翻译、金句与词汇语法分析，积累后使用基于随笔上下文的“知己”对话。可作为 AIU 二面第五项“创意作品”展示。

## 启动

需要 Node.js 20.19+（或兼容的较新版本）。在项目根目录执行：

```powershell
npm install
npm run dev
```

开发页面：`http://localhost:5173`；本地 Node API：`http://127.0.0.1:4318`。开发命令组装前后端进程，前端通过 Vite 代理访问 `/api`。

构建并由后端提供完整应用：

```powershell
npm run build
npm start
```

打开 `http://127.0.0.1:4318`。检查代码：`npm run lint`；自动化检查：`npm test`。`npm run preview` 与 `npm start` 一样由 Node 提供已构建页面和 API。

## 白天与夜间主题

首页右上角、随笔页顶部都有主题按钮，可原位切换“白天模式”和“夜间模式”。白天版使用暖白背景、深色正文，适合明亮房间和投屏；夜间版保留原来的暗底萤光风格，首次正常打开仍默认夜间。

展示时可直接打开 `http://127.0.0.1:4318/notebook?theme=day`；这个链接只决定本次打开的主题，不覆盖个人偏好。手动点主题按钮才记住选择。切换不重新载入页面，不修改随笔、备份或 AI 配置，也不会触发模型请求。

## AI 设置与数据

在应用的 AI 设置中填入 DeepSeek API Key 并保存；保存会先发送一条简短连接测试，成功后才写入后端配置。单独“测试”按钮只验证、不保存。Key 只发给本机后端，由后端调用模型。也可复制 `.env.example` 为 `.env.local`，在后端配置：

```dotenv
DEEPSEEK_API_KEY=填写自己的Key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-flash
```

默认模型依据 [DeepSeek 官方更新记录](https://api-docs.deepseek.com/updates/)；可在设置中改用账户支持的模型。`.env.local` 与后端设置文件 `.local/ai-settings.json` 均不提交。禁止把 Key 改成 `VITE_*` 变量，以免进入浏览器构建产物。已保存的后端设置优先于环境文件；仅用环境配置时，更改后需重启后端。

随笔、对话和词库缓存在当前浏览器的 IndexedDB；端口或域名改变即属于不同存储来源，数据不会自动迁移，迁移前先导出备份。点击 AI 分析或对话时，相关随笔/对话上下文会由后端发给配置的模型服务。未配置 Key 时，本地编辑、词库和备份仍可使用；样例数据不会触发模型调用。

## 功能与真实边界

- 随笔本和富文本编辑、本地保存、JSON 备份与导入。
- 英文翻译、金句、语法和表达分析；本地词库优先，已缓存词条可复用。
- 当前随笔本满 50 篇解锁“知己”；人格来自模型对文字上下文的归纳，不是训练了个人模型。
- 可导入独立的 50 篇虚构演示随笔，避免用真实日记完成演示；样例身份清晰标注，可重复导入而不叠加。
- 模型计算由后端执行；前端提交任务并订阅 SSE 结果，显示进度与错误。

代码具备真实模型接口；是否能成功调用取决于本机 Key、账户权限与网络。演示样例、自动化检查和真实云端验收分别记录，不能相互替代。详见 [演示与验收](docs/interview-demo.md)。

## 模块结构

```text
src/
  main.tsx, App.tsx      # 前端入口与路由组装
  routes/, components/  # 页面和交互展示
  stores/, db/          # 前端状态、用户本地数据
  services/             # API 任务订阅、词库缓存、备份
  data/, types/         # 词表与类型
server/                 # HTTP、AI 任务计算、SSE、服务端设置
scripts/                # 开发进程组装、词表生成、历史部署工具
tests/                  # 后端与接口回归检查
docs/                   # 演示说明、设计记录
```

每个功能目录有简短 README，代码文件顶部说明职责。React 入口只负责挂载和组装；后端入口只负责创建服务和启动。前端管理 UI、订阅与浏览器数据，后端负责模型计算、配置和结果推送。技术栈为 React 19、React Router 7、Vite 8、TypeScript、TipTap、Zustand、Dexie 和 Node 原生 HTTP。

## 词表与部署

已包含生成词表。需要更新时，执行 `npm run build:gaokao3500 -- "CSV文件路径"`；来源与许可见 [NOTICE](NOTICE) 和 [词表工具说明](tools/gaokao3500/README.md)。

完整应用需要 Node 后端，旧 Netlify/Vercel 静态发布方法只能发布页面。见 [Netlify 说明](DEPLOY_NETLIFY.md)、[Vercel 说明](DEPLOY_VERCEL.md)。本次补齐未进行云端部署。

## AI 辅助说明

本项目使用 AI 辅助整理代码、完善接口与文档。面试时应能解释任务提交、服务端推送、本地数据和密钥边界；把现有能力、演示样例与后续计划分别介绍。原始产品草案保留在 [团队产品备忘](docs/TEAM_PRODUCT_NOTES.md)，其中数字人、声音克隆等属于规划，不代表已实现。
