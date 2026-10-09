# 配置

`.env.example`为公开配置模板，首次复制为`.env`；本机`.env`含凭据，忽略Git。`mcp.example.toml`为可迁移示例，实际解释器/仓库路径需按机器调整。

基础智能体读取Ollama/模型配置。论文DeepSeek Key优先在`/research`的“论文模型设置”填写、测试并保存，不在聊天中发送；保存即时生效，手工改文件后重启。公开接口与运行证据不回显Key。
