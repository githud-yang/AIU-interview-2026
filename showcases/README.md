# 创意作品展示

`yinghuo/` 是“萤火”的独立可运行源码快照，对应二面第五项创意作品。原项目保留在 `D:/03_项目与代码/创作项目/荧火`；主工作台与萤火分别启动，二者没有相互调用或共享密钥。

```powershell
cd showcases/yinghuo
npm ci
npm run build
npm start
```

打开 `http://127.0.0.1:4318/notebook`，可导入虚构演示日记集。真实 AI 需在该页面的“AI 设置”配置自己的 Key。详情见项目 README 和 `docs/interview-demo.md`。

从原项目更新快照：在二面仓库运行 `./scripts/sync-yinghuo-showcase.ps1`。`source-manifest.json` 记录来源及文件哈希；密钥、浏览器数据库、node_modules、构建产物、原项目 Git 和无关 PDF/绘图未纳入快照。不要在两个位置同时维护代码。
