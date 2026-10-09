# 模型核心

`llm_agent.py`封装模型传输、上下文检查、工具调用和错误观察；不包含网页或CLI输入输出循环。`LocalLLMAgent.chat()`供CLI及Web服务调用，`health()`提供模型状态。
