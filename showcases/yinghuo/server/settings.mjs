// 管理后端私有配置；外部只可读取脱敏状态，保存前先完成连接验证。
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { completeChat } from './ai/provider.mjs';
import { ServiceError } from './ai/errors.mjs';

const DEFAULTS = { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash', apiKey: '' };
export function validateConfig(value) {
  const config = { ...DEFAULTS, ...value };
  for (const key of ['baseUrl', 'model', 'apiKey']) {
    if (typeof config[key] !== 'string') throw new ServiceError('AI 设置格式不正确。');
    config[key] = config[key].trim();
  }
  config.baseUrl = config.baseUrl.replace(/\/+$/, '');
  if (!['https://api.deepseek.com', 'https://api.deepseek.com/v1'].includes(config.baseUrl)) {
    throw new ServiceError('当前接口仅支持 DeepSeek 官方地址。');
  }
  if (!/^[\w.-]{1,100}$/.test(config.model)) throw new ServiceError('模型名格式不正确。');
  if (config.apiKey.length > 512 || /\s/.test(config.apiKey)) throw new ServiceError('Key 格式不正确。');
  return config;
}
export async function createSettingsStore({ projectDir, env = process.env, complete = completeChat } = {}) {
  const file = join(projectDir, '.local', 'ai-settings.json');
  let saved = {};
  try { saved = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new ServiceError('后端 AI 配置文件无法读取，请检查 .local/ai-settings.json。', 500); }
  let current = validateConfig({ ...DEFAULTS,
    ...(env.DEEPSEEK_API_KEY ? { apiKey: env.DEEPSEEK_API_KEY } : {}),
    ...(env.DEEPSEEK_BASE_URL ? { baseUrl: env.DEEPSEEK_BASE_URL } : {}),
    ...(env.DEEPSEEK_MODEL ? { model: env.DEEPSEEK_MODEL } : {}), ...saved });
  let saving = false;
  const publicView = () => ({ configured: Boolean(current.apiKey), baseUrl: current.baseUrl, model: current.model });
  const candidate = (body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceError('请输入 AI 设置。');
    if (Object.keys(body).some(key => !['apiKey', 'baseUrl', 'model'].includes(key))) throw new ServiceError('设置字段不受支持。');
    return validateConfig({ ...current, ...body, apiKey: typeof body.apiKey === 'string' && !body.apiKey.trim() ? current.apiKey : body.apiKey ?? current.apiKey });
  };
  const test = async (body) => {
    const config = candidate(body);
    await complete(config, [{ role: 'user', content: 'Reply with OK.' }], { json: false, temperature: 0 });
    return { configured: Boolean(config.apiKey), baseUrl: config.baseUrl, model: config.model };
  };
  const save = async (body) => {
    if (saving) throw new ServiceError('正在保存设置，请稍后重试。', 409);
    saving = true;
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      const config = candidate(body);
      await test(body);
      await mkdir(join(projectDir, '.local'), { recursive: true });
      await writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
      await rename(temp, file);
      current = config;
      return publicView();
    } finally { await rm(temp, { force: true }).catch(() => {}); saving = false; }
  };
  return { publicView, candidate, test, save, getConfig: () => ({ ...current }) };
}
