/** 前端配置客户端：只提交输入值和读取脱敏状态，不持久化 API Key。 */
export interface AISettingsStatus {
  configured: boolean;
  model: string;
  baseUrl: string;
}

export interface AISettingsInput {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

async function request(path: string, input?: AISettingsInput): Promise<AISettingsStatus> {
  let response: Response;
  try {
    response = await fetch(path, input === undefined ? { cache: 'no-store' } : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error('无法连接本地后端，请确认前后端服务已启动后重试。');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || '配置请求失败，请重试。');
  if (!data || typeof data.configured !== 'boolean') throw new Error('后端响应格式异常，请确认启动了萤火后端。');
  return { configured: data.configured, model: String(data.model || 'deepseek-flash'), baseUrl: String(data.baseUrl || 'https://api.deepseek.com/v1') };
}

export const getAISettings = () => request('/api/settings');
export const saveAISettings = (input: AISettingsInput) => request('/api/settings', input);
export const testAISettings = (input: AISettingsInput) => request('/api/settings/test', input);
