// 同时启动本地 API 与 Vite；只清理由本进程启动的子进程。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const args of [['--watch', 'server/index.mjs'], ['node_modules/vite/bin/vite.js']]) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('error', () => { console.error('开发服务未能启动。'); stop(1); });
  child.on('exit', code => stop(code || 0));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
