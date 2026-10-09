// 只提交任务和订阅服务端结果；提示词、模型调用及输出校验均在后端。
interface TaskSnapshot<T> { id: string; status: 'running' | 'completed' | 'error'; result?: T; error?: { message: string } }
export async function runAiTask<T>(type: string, input: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch('/api/ai/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, input }) }); }
  catch { throw new Error('无法连接萤火后端，请确认服务已启动。'); }
  const initial = await response.json().catch(() => null);
  if (!response.ok || !initial?.id) throw new Error(initial?.error?.message || '无法创建 AI 任务，请确认后端已启动。');
  return new Promise<T>((resolve, reject) => {
    const source = new EventSource(`/api/ai/tasks/${encodeURIComponent(initial.id)}/events`);
    const timer = window.setTimeout(() => fail('AI 结果订阅超时，请重试。'), 100000);
    function close() { window.clearTimeout(timer); source.close(); }
    function fail(message: string) { close(); reject(new Error(message)); }
    source.addEventListener('task', event => {
      let job: TaskSnapshot<T>;
      try { job = JSON.parse((event as MessageEvent).data); }
      catch { return fail('AI 结果格式不正确，请重试。'); }
      if (!job || typeof job !== 'object' || job.id !== initial.id || !['running', 'completed', 'error'].includes(job.status)) return fail('AI 任务状态不正确，请重试。');
      if (job.status === 'completed') { close(); if (job.result === undefined) reject(new Error('AI 未返回结果，请重试。')); else resolve(job.result); }
      else if (job.status === 'error') fail(job.error?.message || 'AI 处理失败，请重试。');
    });
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) fail('任务订阅中断，请重试。'); };
  });
}
