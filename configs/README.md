# 配置文件目录

存放所有环境配置，**不要把真实密钥提交到Git**。

## 文件
- `.env.example`：配置模板，复制为`.env`后修改
- `.env`：实际配置文件（已加入.gitignore）

## 配置项
| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `LLM_PROVIDER` | 模型提供商：ollama / deepseek | ollama |
| `OLLAMA_BASE_URL` | 本地Ollama地址 | http://localhost:11434 |
| `OLLAMA_MODEL` | 本地模型名 | qwen2.5:7b |
| `DEEPSEEK_API_KEY` | DeepSeek云端API密钥 | 空 |
