// 保存短期任务状态并推送；重新订阅只重放状态，不重复调用模型。
import { randomUUID } from 'node:crypto';
import { ServiceError, publicError } from './ai/errors.mjs';

export function createJobRegistry(ai, { retentionMs = 900000, maxRetained = 128 } = {}) {
  const jobs = new Map();
  const terminal = job => ['completed', 'error'].includes(job.status);
  function prune(makeRoom = false) {
    for (const [id, job] of jobs) if (terminal(job) && Date.now() - job.finishedAt > retentionMs) jobs.delete(id);
    if (makeRoom) for (const [id, job] of jobs) { if (jobs.size < maxRetained) break; if (terminal(job)) jobs.delete(id); }
  }
  const view = job => ({ id: job.id, status: job.status, ...(job.result !== undefined ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) });
  return {
    create(type, input) {
      prune(true);
      if (jobs.size >= maxRetained) throw new ServiceError('当前服务忙，请等待正在运行的任务完成。', 503);
      ai.prepare?.(type, input);
      const job = { id: randomUUID(), status: 'running', listeners: new Set() };
      jobs.set(job.id, job);
      Promise.resolve().then(() => ai.execute(type, input)).then(result => {
        job.status = 'completed'; job.result = result;
      }, error => {
        job.status = 'error'; job.error = { message: publicError(error) };
      }).finally(() => { job.finishedAt = Date.now(); for (const listener of job.listeners) listener(view(job)); });
      return view(job);
    },
    subscribe(id, listener) {
      prune();
      const job = jobs.get(id);
      if (!job) throw new ServiceError('任务不存在或已过期，请重新发起。', 404);
      job.listeners.add(listener); listener(view(job));
      return () => job.listeners.delete(listener);
    },
    hasRunning: () => [...jobs.values()].some(job => !terminal(job)),
    close: () => { for (const job of jobs.values()) job.listeners.clear(); jobs.clear(); },
  };
}
