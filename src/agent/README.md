# LLM智能体模块

本地大模型智能体，支持工具调用，可切换本地Ollama和云端DeepSeek后端。

## 目录
- `core/llm_agent.py`：Agent核心类，处理对话和工具调用循环
- `tools/registry.py`：工具注册表，新增工具只需在此文件追加

## 运行方式
```powershell
python -m src.agent.core.llm_agent
```

## 配置
配置文件在项目根目录 `configs/.env`，参考 `.env.example`：
- `LLM_PROVIDER=ollama` 或 `deepseek`
- 填入对应的API地址和密钥即可切换后端
