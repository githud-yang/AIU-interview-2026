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
| execution.py | 登记执行边界与能力说明 |
| mcp_server.py | 通过同一HTTP API提供八个MCP工具 |

入口为`/research`，操作和复现限制见`../../docs/research-workbench.md`。灵感/期刊首批资料属于探索，不代表自动研究贡献、实际投稿或录用。完整原始运行在忽略Git的`logs/research/`，摘要在`evidence/`。
