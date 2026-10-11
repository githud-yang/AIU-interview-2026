# 科研Harness（进阶）

本模块属于面试第四项进阶任务。只执行已注册的digits高斯增强和YOLO输入尺寸对比，不执行任意模型生成代码。

| 文件 | 职责 |
| --- | --- |
| contracts.py | 输入、阶段和输出契约 |
| runtime.py、store.py | 工作流组装、调度、状态账本、幂等与恢复 |
| domain.py、yolo_domain.py | 两类可信实验的计算与证据 |
| yolo_workflow.py | YOLO领域阶段适配 |
| literature.py | 元数据检索与公开全文获取 |
| provider.py、writer.py、settings.py | 控制模型、论文模型与本机Key设置 |
| manuscript.py、yolo_manuscript.py | 从已核验数据生成报告，不把模型回复当实测结果 |
| yolo_chinese_report.py | 从冻结 YOLO 证据导出独立中文阅读稿，登记新版本，不覆盖英文历史稿 |
| execution.py | 登记执行边界与能力说明 |
| mcp_server.py | 通过同一HTTP API提供八个MCP工具 |

入口为`/research`，操作和复现限制见`../../docs/research-workbench.md`。灵感/期刊首批资料属于探索，不代表自动研究贡献、实际投稿或录用。完整原始运行在忽略Git的`logs/research/`，摘要在`evidence/`。

YOLO 首稿、审查修订及后续论文导出默认同时生成中文阅读稿，版本目录为 `reading_zh_v<revision>`，通过同一产物契约登记。默认阅读语言为中文，英文稿与原英文 PDF、归档和历史清单保留；中文阅读版不代表已完成中文期刊格式要求。`manuscript.chinese_reading` 提供该次导出的中文版本与文件，`default_reading_language` 标记阅读偏好，不把整套资料宣称为中文期刊稿。

也可单独复用已完成的 YOLO 运行导出；命令只核查证据与排版，不启动训练、评测或模型请求。已有目录输入不一致时拒绝覆盖，修改稿请指定新目录名称。

```powershell
./.venv/Scripts/python.exe -X utf8 -m src.research.yolo_chinese_report bd8c2a7ccaff4ae4b3be7f7e6fa13c43 --directory reading_zh_v2
```

输出为运行目录下的 `paper.zh.html`、`paper.zh.md`、中文图表、`paper.zh.pdf` 与来源清单，通过现有产物下载接口访问。单独命令导出时，`outputs.chinese_reading` 指向最新登记版本；原阶段输出、预算和英文稿保留。
