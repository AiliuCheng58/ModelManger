import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { App_create, App_errors } from './app.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.MODEL_ATELIER_DATA ?? resolve(root, 'data'));
const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口号');
const { app, store, queue } = App_create(directory);
let vite: import('vite').ViteDevServer | undefined;
if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')));
  app.get('/{*path}', (_req, res) => { res.sendFile(resolve(root, 'dist/index.html')); });
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}
App_errors(app);
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Model Atelier 已启动：http://127.0.0.1:${port}`);
  console.log(`数据目录：${directory}`);
});
server.on('error', error => { console.error(`服务启动失败：${error.message}`); process.exitCode = 1; });

/** @brief 关闭 HTTP 连接和任务请求后安全释放数据库。 */
async function Server_close() {
  server.close();
  server.closeAllConnections();
  await queue.Queue_close();
  await vite?.close();
  store.db.close();
}
process.once('SIGINT', () => { void Server_close(); });
process.once('SIGTERM', () => { void Server_close(); });
