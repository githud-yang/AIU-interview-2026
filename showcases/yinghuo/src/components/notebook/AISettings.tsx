/** DeepSeek 配置界面：展示脱敏状态，手动保存或测试，不自动发送研究/日记内容。 */
import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import Modal from '../ui/Modal';
import { getAISettings, saveAISettings, testAISettings } from '../../services/aiSettings';
import type { AISettingsStatus } from '../../services/aiSettings';

const inputStyle = { border: '1px solid var(--yh-line-030)', color: 'var(--yh-text)', background: 'var(--yh-input)', borderRadius: 8, padding: '9px 11px', width: '100%' };
const buttonStyle = { color: 'var(--yh-accent)', border: '1px solid var(--yh-line-030)', borderRadius: 8, padding: '8px 12px', background: 'var(--yh-tint-008)' };

export default function AISettings() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AISettingsStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-flash');
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy('load');
    setError('');
    setMessage('');
    getAISettings().then(result => {
      if (!cancelled) { setStatus(result); setModel(result.model); }
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : '读取配置失败。');
    }).finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [open]);

  const close = () => {
    if (busy) return;
    setApiKey('');
    setOpen(false);
  };

  const run = async (action: 'save' | 'test') => {
    if (busy) return;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      const input = { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), model: model.trim() };
      const result = await (action === 'save' ? saveAISettings(input) : testAISettings(input));
      setStatus(result);
      if (action === 'save') { setApiKey(''); setMessage('配置已保存到本地后端。'); }
      else setMessage('连接测试通过。测试会发送一条简短请求；未发送日记内容。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请重试。');
    } finally { setBusy(null); }
  };

  return <>
    <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5" style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-072)' }}>
      <KeyRound size={13} /> AI 设置
    </button>
    <Modal open={open} onClose={close} title="DeepSeek 设置">
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void run('save'); }}>
        <p role="status" style={{ color: 'var(--yh-secondary)', fontSize: 'var(--yh-font-08)' }}>
          {busy === 'load' ? '正在读取配置…' : status ? (status.configured ? '后端已配置 API Key，密钥不回显。' : '尚未配置 API Key。') : '配置状态未读取。'}
        </p>
        <label style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-078)' }}>
          API Key
          <input autoComplete="off" type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={status?.configured ? '留空保留已保存的 Key' : '输入 DeepSeek API Key'} disabled={!!busy} style={inputStyle} />
        </label>
        <label style={{ color: 'var(--yh-accent)', fontSize: 'var(--yh-font-078)' }}>
          模型
          <input value={model} onChange={event => setModel(event.target.value)} placeholder="deepseek-flash" required disabled={!!busy} style={inputStyle} />
        </label>
        <p style={{ color: 'var(--yh-muted)', fontSize: 'var(--yh-font-07)', overflowWrap: 'anywhere' }}>服务地址：{status?.baseUrl || 'https://api.deepseek.com/v1'}<br />主动点击分析、画像或发送消息时，对应内容会发送给 DeepSeek。连接测试也会产生一次 API 请求。</p>
        {error && <p role="alert" style={{ color: 'var(--yh-error)', fontSize: 'var(--yh-font-078)' }}>{error} 可再次点击保存或测试重试。</p>}
        {message && <p role="status" style={{ color: 'var(--yh-success)', fontSize: 'var(--yh-font-078)' }}>{message}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" disabled={!!busy} onClick={() => void run('test')} style={buttonStyle}>{busy === 'test' ? <Loader2 className="animate-spin" size={15} /> : '测试连接'}</button>
          <button type="submit" disabled={!!busy || !model.trim()} style={buttonStyle}>{busy === 'save' ? '保存中…' : '保存配置'}</button>
        </div>
      </form>
    </Modal>
  </>;
}
