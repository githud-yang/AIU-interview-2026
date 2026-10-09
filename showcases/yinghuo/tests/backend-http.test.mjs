// 用临时目录和本机随机端口验证接口边界与 SSE 恢复；不访问真实模型或用户数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.mjs';
import { createSettingsStore } from '../server/settings.mjs';

const secret = 'http-test-only-private-key';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function start(t, ai = { execute: async () => ({ ok: true }) }, options = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'yinghuo-http-test-'));
  const distDir = join(projectDir, 'dist');
  await mkdir(join(distDir, 'assets'), { recursive: true });
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Test application</title>');
  await writeFile(join(distDir, 'assets', 'app.js'), 'console.log("test asset");');
  await writeFile(join(projectDir, 'private.txt'), secret);
  await writeFile(join(distDir, '.env'), secret);
  const settings = await createSettingsStore({ projectDir, env: { DEEPSEEK_API_KEY: secret }, complete: async () => 'OK' });
  const app = createApp({ settings, ai, distDir, ...options });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const port = app.address().port;
  t.after(async () => {
    const closed = new Promise(resolve => app.close(resolve));
    app.closeAllConnections();
    await closed;
    await rm(projectDir, { recursive: true, force: true });
  });
  return { app, port, settings, projectDir, distDir };
}

function request(port, path, { method = 'GET', headers = {}, body, agent = false } = {}) {
  return new Promise((resolve, reject) => {
    const raw = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port, path, method, agent, headers: {
      Connection: 'close', ...(raw === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) }), ...headers,
    } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('error', () => {});
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('test HTTP request timed out')));
    req.on('error', reject);
    req.end(raw);
  });
}

function openSse(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, agent: false, headers: { Connection: 'close' } }, res => {
      const events = [], waiters = [];
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buffer += chunk;
        let separator;
        while ((separator = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, separator); buffer = buffer.slice(separator + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (!data) continue;
          const value = JSON.parse(data.slice(6));
          const waiter = waiters.shift();
          if (waiter) { clearTimeout(waiter.timer); waiter.resolve(value); }
          else events.push(value);
        }
      });
      const ended = new Promise(yes => res.on('end', yes));
      resolve({
        response: res, ended,
        next: () => events.length ? Promise.resolve(events.shift()) : new Promise((yes, no) => {
          const waiter = { resolve: yes, timer: setTimeout(() => no(new Error('SSE event timed out')), 2000) };
          waiters.push(waiter);
        }),
        close: async () => {
          if (res.destroyed) return;
          const closed = new Promise(yes => res.once('close', yes));
          req.destroy();
          await closed;
        },
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test('local health and settings responses reveal status only, without enabling CORS', async t => {
  const { port } = await start(t);
  const health = await request(port, '/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json(), { ok: true });
  const settings = await request(port, '/api/settings');
  assert.equal(settings.status, 200);
  assert.equal(settings.json().configured, true);
  assert.equal(settings.text.includes(secret), false);
  assert.equal('apiKey' in settings.json(), false);
  assert.equal(settings.headers['access-control-allow-origin'], undefined);
  assert.equal(settings.headers['cache-control'], 'no-store');
  assert.equal(settings.headers['x-content-type-options'], 'nosniff');
});

test('foreign origins, nonlocal Host and anonymous cross-site requests are rejected', async t => {
  let executions = 0;
  const { port } = await start(t, { execute: async () => { executions++; return {}; } });
  for (const headers of [
    { Origin: 'https://evil.example' }, { Host: 'evil.example' },
    { Host: '127.0.0.1.evil.example' }, { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const result = await request(port, '/api/ai/tasks', { method: 'POST', headers, body: { type: 'analyzeWord', input: { word: 'light' } } });
    assert.equal(result.status, 403);
  }
  assert.equal(executions, 0);
  assert.equal((await request(port, '/api/health', { headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
  assert.equal((await request(port, '/api/health', { headers: { Origin: 'http://localhost:5173' } })).status, 200);
});

test('settings API verifies official addresses and never returns the entered key', async t => {
  const { port } = await start(t);
  const invalid = await request(port, '/api/settings/test', { method: 'POST', body: { baseUrl: 'http://127.0.0.1/private' } });
  assert.equal(invalid.status, 400);
  const testResult = await request(port, '/api/settings/test', { method: 'POST', body: { apiKey: 'new-private-key' } });
  assert.equal(testResult.status, 200);
  assert.equal(testResult.text.includes('new-private-key'), false);
  const saveResult = await request(port, '/api/settings', { method: 'POST', body: { apiKey: 'new-private-key' } });
  assert.equal(saveResult.status, 200);
  assert.equal(saveResult.text.includes('new-private-key'), false);
  assert.equal((await request(port, '/api/settings')).text.includes('new-private-key'), false);
});

test('unconfigured applications explain the missing key before creating model work', async t => {
  let calls = 0;
  const { port } = await start(t, { execute: async () => { calls++; } }, { settings: { publicView: () => ({ configured: false }) } });
  const result = await request(port, '/api/ai/tasks', { method: 'POST', body: { type: 'analyzeWord', input: { word: 'light' } } });
  assert.equal(result.status, 503);
  assert.match(result.json().error.message, /尚未配置/);
  assert.equal(calls, 0);
});

test('invalid request JSON and content types have explicit client errors', async t => {
  const { port } = await start(t);
  assert.equal((await request(port, '/api/ai/tasks', { method: 'POST', body: '{broken' })).status, 400);
  assert.equal((await request(port, '/api/ai/tasks', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  for (const body of ['null', '[]', '"string"']) {
    assert.equal((await request(port, '/api/ai/tasks', { method: 'POST', body })).status, 400);
  }
  assert.equal((await request(port, '/api/not-found')).status, 404);
});

test('oversized commands return a readable 413 response while the server remains available', async t => {
  const { port } = await start(t);
  const result = await request(port, '/api/ai/tasks', { method: 'POST', body: { type: 'analyzeNote', input: { noteId: 'demo', content: 'x'.repeat(1048576) } } });
  assert.equal(result.status, 413);
  assert.match(result.json().error.message, /过长/);
  assert.equal((await request(port, '/api/health')).status, 200);
});

test('task stream reconnects and terminal replay do not execute the model again', { timeout: 5000 }, async t => {
  const work = deferred();
  let executions = 0;
  const { port } = await start(t, { execute: async () => { executions++; return work.promise; } });
  const command = await request(port, '/api/ai/tasks', { method: 'POST', body: { type: 'analyzeWord', input: { word: 'light' } } });
  assert.equal(command.status, 202);
  const job = command.json();
  assert.equal(job.status, 'running');
  const path = `/api/ai/tasks/${job.id}/events`;
  const first = await openSse(port, path);
  assert.match(first.response.headers['content-type'], /^text\/event-stream/);
  assert.equal((await first.next()).status, 'running');
  await first.close();
  const second = await openSse(port, path);
  assert.equal((await second.next()).status, 'running');
  work.resolve({ word: 'light', meaning: '光' });
  const complete = await second.next();
  assert.equal(complete.status, 'completed');
  assert.deepEqual(complete.result, { word: 'light', meaning: '光' });
  await second.ended;
  const replay = await request(port, path, { headers: { 'Last-Event-ID': 'ignored-state-cursor' } });
  assert.equal(replay.status, 200, JSON.stringify({ text: replay.text, headers: replay.headers }));
  assert.equal(replay.text.split('event: task').length - 1, 1);
  assert.match(replay.text, /"status":"completed"/);
  assert.equal(executions, 1);
});

test('failed tasks end their SSE stream with a safe error, without fabricated results', async t => {
  let executions = 0;
  const { port } = await start(t, { execute: async () => { executions++; throw new Error(`upstream-private ${secret}`); } });
  const command = await request(port, '/api/ai/tasks', { method: 'POST', body: { type: 'analyzeWord', input: { word: 'light' } } });
  const stream = await request(port, `/api/ai/tasks/${command.json().id}/events`);
  assert.equal(stream.status, 200);
  assert.match(stream.text, /"status":"error"/);
  assert.equal(stream.text.includes(secret), false);
  assert.equal(stream.text.includes('"result"'), false);
  assert.equal(executions, 1);
  const missing = await request(port, '/api/ai/tasks/does-not-exist/events');
  assert.equal(missing.status, 404, JSON.stringify({ text: missing.text, headers: missing.headers }));
  assert.match(missing.headers['content-type'], /^application\/json/);
});

test('terminal SSE honors a closing client connection so HTTP agents cannot reuse a closed socket', async t => {
  const { port } = await start(t);
  const agent = new Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  const command = await request(port, '/api/ai/tasks', { method: 'POST', agent, body: { type: 'analyzeWord', input: { word: 'light' } } });
  const stream = await request(port, `/api/ai/tasks/${command.json().id}/events`, { agent });
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.connection, 'close');
  assert.equal((await request(port, '/api/health', { agent })).status, 200);
});

test('settings stay stable while an AI task is running', async t => {
  const work = deferred();
  const { port } = await start(t, { execute: async () => work.promise });
  const command = await request(port, '/api/ai/tasks', { method: 'POST', body: { type: 'analyzeWord', input: { word: 'light' } } });
  for (const path of ['/api/settings', '/api/settings/test']) {
    assert.equal((await request(port, path, { method: 'POST', body: { apiKey: 'changed-private-key' } })).status, 409);
  }
  work.resolve({ ok: true });
  await request(port, `/api/ai/tasks/${command.json().id}/events`);
  const settingsResult = await request(port, '/api/settings/test', { method: 'POST', body: {} });
  assert.equal(settingsResult.status, 200, JSON.stringify({ text: settingsResult.text, headers: settingsResult.headers }));
});

test('static files and SPA routes work while hidden files and traversal remain inaccessible', async t => {
  const { port } = await start(t);
  const index = await request(port, '/');
  assert.equal(index.status, 200);
  assert.match(index.headers['content-type'], /^text\/html/);
  assert.equal((await request(port, '/notebook/demo')).text, index.text);
  const asset = await request(port, '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers['content-type'], /^text\/javascript/);
  assert.equal((await request(port, '/assets/app.js', { method: 'HEAD' })).text, '');
  for (const path of ['/.env', '/.local/ai-settings.json', '/server/app.mjs', '/%2e%2e%2fprivate.txt', '/assets/%2e%2e%5c%2e%2e%5cprivate.txt', '/%00private.txt']) {
    const result = await request(port, path);
    assert.equal(result.status, 404, path);
    assert.equal(result.text.includes(secret), false, path);
  }
});

test('static realpath checks reject links that point outside the build directory', async t => {
  const { port, projectDir, distDir } = await start(t);
  try { await symlink(join(projectDir, 'private.txt'), join(distDir, 'public-link.txt'), 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('系统未授予创建符号链接的权限'); return; }
    throw error;
  }
  const result = await request(port, '/public-link.txt');
  assert.equal(result.status, 404);
  assert.equal(result.text.includes(secret), false);
});

test('static realpath checks also reject directory junctions outside the build directory', async t => {
  const { port, projectDir, distDir } = await start(t);
  try { await symlink(projectDir, join(distDir, 'outside-junction'), 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('系统未授予创建目录链接的权限'); return; }
    throw error;
  }
  const result = await request(port, '/outside-junction/private.txt');
  assert.equal(result.status, 404);
  assert.equal(result.text.includes(secret), false);
});
