// 单元测试直接转译现有 TypeScript，用网络/订阅桩验证行为；不宣称浏览器验收。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let moduleSequence = 0;
const replacedGlobals = new WeakMap();
async function loadTransport() {
  const source = await readFile(new URL('../src/services/aiTransport.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(`${outputText}\n// test instance ${moduleSequence++}`).toString('base64')}`);
}

function replaceGlobal(t, name, value) {
  const names = replacedGlobals.get(t) ?? new Set();
  replacedGlobals.set(t, names);
  if (!names.has(name)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
    names.add(name);
  }
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
async function harness(t, fetchReply = async () => new Response(JSON.stringify({ id: 'task-1', status: 'running' }), { status: 202 })) {
  const requests = [], sources = [], timers = new Map();
  let timerId = 0;
  replaceGlobal(t, 'fetch', async (...args) => { requests.push(args); return fetchReply(...args); });
  class FakeEventSource {
    static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
    constructor(url) { this.url = url; this.readyState = 1; this.closed = false; this.listeners = new Map(); sources.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(value) { this.emitText(JSON.stringify(value)); }
    emitText(data) { this.listeners.get('task')?.({ data }); }
    close() { this.closed = true; this.readyState = 2; }
    disconnect(state) { this.readyState = state; this.onerror?.({}); }
  }
  replaceGlobal(t, 'EventSource', FakeEventSource);
  replaceGlobal(t, 'window', {
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const { runAiTask } = await loadTransport();
  return { runAiTask, requests, sources, timers, FakeEventSource, flush: () => new Promise(resolve => setImmediate(resolve)),
    expire: () => { for (const [id, timer] of timers) { timers.delete(id); timer.callback(); } },
  };
}

test('transport submits one command, waits for completion, and releases subscription and timer', async t => {
  const h = await harness(t);
  const result = h.runAiTask('analyzeWord', { word: 'light' });
  await h.flush();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], '/api/ai/tasks');
  assert.deepEqual(JSON.parse(h.requests[0][1].body), { type: 'analyzeWord', input: { word: 'light' } });
  assert.equal(h.sources[0].url, '/api/ai/tasks/task-1/events');
  h.sources[0].emit({ id: 'task-1', status: 'running' });
  h.sources[0].emit({ id: 'task-1', status: 'completed', result: { word: 'light', meaning: '光' } });
  assert.deepEqual(await result, { word: 'light', meaning: '光' });
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.timers.size, 0);
});

test('native EventSource reconnects without re-posting a model command', async t => {
  const h = await harness(t);
  const result = h.runAiTask('analyzeWord', { word: 'light' });
  await h.flush();
  h.sources[0].disconnect(h.FakeEventSource.CONNECTING);
  h.sources[0].disconnect(h.FakeEventSource.CONNECTING);
  assert.equal(h.sources[0].closed, false);
  h.sources[0].emit({ id: 'task-1', status: 'completed', result: { word: 'light' } });
  await result;
  assert.equal(h.requests.length, 1);
  assert.equal(h.sources.length, 1);
});

test('task errors and missing results reject without returning placeholder success', async t => {
  for (const event of [
    { id: 'task-1', status: 'error', error: { message: '余额不足，请检查设置' } },
    { id: 'task-1', status: 'completed' },
  ]) {
    const h = await harness(t);
    const result = h.runAiTask('analyzeWord', { word: 'light' });
    const rejected = assert.rejects(result, event.status === 'error' ? /余额不足/ : /未返回结果/);
    await h.flush();
    h.sources[0].emit(event);
    await rejected;
    assert.equal(h.sources[0].closed, true);
    assert.equal(h.timers.size, 0);
  }
});

test('malformed and unrelated task snapshots fail promptly and close the subscription', async t => {
  for (const text of ['not json', 'null', '[]', '{"id":"task-1","status":"unknown"}', '{"id":"other-task","status":"completed","result":"wrong result"}']) {
    const h = await harness(t);
    const result = h.runAiTask('analyzeWord', { word: 'light' });
    const rejected = assert.rejects(result, /格式|任务|结果/);
    await h.flush();
    assert.doesNotThrow(() => h.sources[0].emitText(text), text);
    await rejected;
    assert.equal(h.sources[0].closed, true);
    assert.equal(h.timers.size, 0);
  }
});

test('permanently closed SSE rejects and frees its timeout', async t => {
  const h = await harness(t);
  const result = h.runAiTask('analyzeWord', { word: 'light' });
  const rejected = assert.rejects(result, /订阅中断/);
  await h.flush();
  h.sources[0].disconnect(h.FakeEventSource.CLOSED);
  await rejected;
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.timers.size, 0);
});

test('subscription timeout closes SSE without starting additional model work', async t => {
  const h = await harness(t);
  const result = h.runAiTask('analyzeWord', { word: 'light' });
  const rejected = assert.rejects(result, /订阅超时/);
  await h.flush();
  assert.equal([...h.timers.values()][0].delay, 100000);
  h.expire();
  await rejected;
  assert.equal(h.sources[0].closed, true);
  assert.equal(h.requests.length, 1);
});

test('unreachable backend and rejected commands do not create event subscriptions', async t => {
  for (const [reply, pattern] of [
    [async () => { throw new Error('network error'); }, /无法连接萤火后端/],
    [async () => new Response(JSON.stringify({ error: { message: '尚未配置 Key' } }), { status: 503 }), /尚未配置 Key/],
    [async () => new Response('invalid JSON', { status: 502 }), /无法创建 AI 任务/],
    [async () => new Response('{}', { status: 202 }), /无法创建 AI 任务/],
  ]) {
    const h = await harness(t, reply);
    await assert.rejects(h.runAiTask('analyzeWord', { word: 'light' }), pattern);
    assert.equal(h.sources.length, 0);
    assert.equal(h.timers.size, 0);
  }
});
