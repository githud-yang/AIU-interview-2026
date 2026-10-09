// 仅在服务端调用 DeepSeek；检查空响应、截断、超时及上游状态。
import { ServiceError } from './errors.mjs';

export async function completeChat(config, messages, { json = true, temperature = 0.3, fetchImpl = fetch, timeoutMs = 90000 } = {}) {
  if (!config.apiKey) throw new ServiceError('尚未配置 DeepSeek Key，请打开 AI 设置。', 503);
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature, max_tokens: 4096,
        thinking: { type: 'disabled' }, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
    });
    if (!response.ok) {
      const reason = { 401: 'Key 无效', 402: '账户余额不足', 429: '请求繁忙或触发限流', 400: '模型或请求参数不受支持' }[response.status];
      throw new ServiceError(`DeepSeek ${reason || '暂时不可用'}（${response.status}），请检查设置后重试。`, 502);
    }
    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== 'stop') {
      throw new ServiceError('AI 回复被截断或中断，请缩短内容后重试。', 502);
    }
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new ServiceError('AI 返回了空内容，请重试。', 502);
    return content.trim();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(error?.name === 'TimeoutError' ? 'AI 请求超时，请重试。' : '无法连接 DeepSeek，请检查网络后重试。', 502);
  }
}
