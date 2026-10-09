// 组装本地 HTTP 路由、SSE 订阅和静态资源；AI 计算交给独立服务。
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, extname, sep, isAbsolute } from 'node:path';
import { createJobRegistry } from './jobs.mjs';
import { ServiceError, publicError } from './ai/errors.mjs';

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function readJson(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new ServiceError('请求需要 application/json。', 415);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1048576) throw new ServiceError('提交的内容过长，请缩短后重试。', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ServiceError('请求 JSON 格式不正确。'); }
}
function validateLocalRequest(request, allowedOrigins) {
  const host = request.headers.host || '';
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) throw new ServiceError('仅支持本机访问。', 403);
  const origin = request.headers.origin;
  if (origin && origin !== `http://${host}` && !allowedOrigins.includes(origin)) throw new ServiceError('不接受其他站点的请求。', 403);
  if (request.headers['sec-fetch-site'] === 'cross-site' && !origin) throw new ServiceError('不接受跨站请求。', 403);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
async function staticFile(request, response, pathname, distDir) {
  if (pathname.split(/[\\/]/).some(part => part.startsWith('.')) || pathname.includes('\0')) throw new ServiceError('资源不存在。', 404);
  const root = await realpath(distDir).catch(() => { throw new ServiceError('尚未构建前端，请先运行 npm run build，开发时使用 npm run dev。', 503); });
  let actual;
  try { actual = await realpath(resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)); }
  catch {
    if (extname(pathname)) throw new ServiceError('资源不存在。', 404);
    actual = await realpath(resolve(root, 'index.html'));
  }
  const child = relative(root, actual);
  if (child.startsWith(`..${sep}`) || child === '..' || isAbsolute(child)) throw new ServiceError('资源不存在。', 404);
  const data = await readFile(actual).catch(() => { throw new ServiceError('资源不存在。', 404); });
  response.writeHead(200, { 'Content-Type': MIME[extname(actual)] || 'application/octet-stream', 'Cache-Control': extname(actual) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  response.end(request.method === 'HEAD' ? undefined : data);
}
export function createApp({ settings, ai, distDir = resolve('dist'), allowedOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'] } = {}) {
  const jobs = createJobRegistry(ai);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    try {
      validateLocalRequest(request, allowedOrigins);
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
      catch { throw new ServiceError('请求地址不正确。'); }
      if (request.method === 'GET' && pathname === '/api/health') return json(response, 200, { ok: true });
      if (request.method === 'GET' && pathname === '/api/settings') return json(response, 200, settings.publicView());
      if (request.method === 'POST' && ['/api/settings', '/api/settings/test'].includes(pathname)) {
        if (jobs.hasRunning()) throw new ServiceError('AI 任务运行中，请完成后再修改设置。', 409);
        const body = await readJson(request);
        return json(response, 200, pathname.endsWith('/test') ? await settings.test(body) : await settings.save(body));
      }
      if (request.method === 'POST' && pathname === '/api/ai/tasks') {
        const body = await readJson(request);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceError('任务输入格式不正确。');
        if (!settings.publicView().configured) throw new ServiceError('尚未配置 DeepSeek Key，请打开 AI 设置。', 503);
        return json(response, 202, jobs.create(body.type, body.input));
      }
      const match = pathname.match(/^\/api\/ai\/tasks\/([\w-]+)\/events$/);
      if (request.method === 'GET' && match) {
        let unsubscribe = () => {}, finished = false;
        const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': keep-alive\n\n'); }, 15000);
        heartbeat.unref();
        response.on('close', () => { finished = true; clearInterval(heartbeat); unsubscribe(); });
        const listener = job => {
          if (response.destroyed) return;
          if (!response.headersSent) response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
          response.write(`event: task\ndata: ${JSON.stringify(job)}\n\n`);
          if (['completed', 'error'].includes(job.status)) { finished = true; clearInterval(heartbeat); response.end(); }
        };
        try { unsubscribe = jobs.subscribe(match[1], listener); if (finished) unsubscribe(); }
        catch (error) { clearInterval(heartbeat); throw error; }
        return;
      }
      if (pathname.startsWith('/api/')) throw new ServiceError('接口不存在。', 404);
      if (['GET', 'HEAD'].includes(request.method)) return await staticFile(request, response, pathname, distDir);
      throw new ServiceError('请求方法不受支持。', 405);
    } catch (error) {
      if (!response.headersSent) json(response, error instanceof ServiceError ? error.status : 500, { error: { message: publicError(error) } });
      else response.end();
    }
  });
  server.on('close', jobs.close); return server;
}
