// 主入口只负责读取环境、组装依赖并监听本地端口。
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { createSettingsStore } from './settings.mjs';
import { createAiService } from './ai/tasks.mjs';
import { createApp } from './app.mjs';
const projectDir = fileURLToPath(new URL('../', import.meta.url));
try { loadEnvFile(resolve(projectDir, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const settings = await createSettingsStore({ projectDir });
const ai = createAiService({ settings });
const app = createApp({ settings, ai, distDir: resolve(projectDir, 'dist') });
const port = Number(process.env.PORT || 4318);
app.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已占用。请检查已有服务。` : '服务启动失败。'); process.exitCode = 1; });
app.listen(port, '127.0.0.1', () => console.log(`萤火：http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.close(); app.closeAllConnections(); });
