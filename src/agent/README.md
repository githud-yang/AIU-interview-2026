# 本地模型与智能体

- `core/`：模型请求、消息校验与工具执行循环。
- `tools/`：工具schema、参数校验与实际计算。
- `interfaces/`：CLI输入输出，独立于模型实现。
- `cli.py`：仅组装模型与CLI界面。

从仓库根目录运行：

```powershell
./.venv/Scripts/python.exe -m src.agent.cli
```

Ollama模型与API配置见`../../configs/README.md`。网页文字冒险通过`web/services/chat_service.py`复用本模块；持久科研Harness独立位于`research/`。旧内存会话原型已归档，不作为完整Harness交付。
