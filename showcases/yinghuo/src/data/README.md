# 本地词表

`presetVocab.ts` 提供预置词条，`gaokao3500Bundle.ts` 适配生成 JSON，`vocabData.ts` 保留扩展词表。词库服务负责将需要的词条写入浏览器缓存。

生成数据用 `npm run build:gaokao3500 -- "CSV路径"` 更新；原始来源与许可见根目录 `NOTICE`。生成 JSON 是数据文件，不添加代码注释。
