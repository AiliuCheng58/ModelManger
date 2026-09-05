import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { z } from 'zod';
import { Store_open, Secret_hash, Password_hash, Password_verify, HttpError } from './store.ts';
import { Provider_list, Provider_save, Provider_remove, Provider_sync, Model_list, Model_save, Model_resolve, Provider_fetch } from './providers.ts';
import { TaskQueue, Call_record, Stats_get } from './tasks.ts';
import { Mcp_mount } from './mcp.ts';

const Password_schema = z.object({ password: z.string().min(8, '管理口令至少需要 8 个字符').max(200) });
const Chat_schema = z.object({ model: z.string().min(1), stream: z.boolean().optional(),
  messages: z.array(z.object({ role: z.enum(['system', 'developer', 'user', 'assistant', 'tool', 'function']) }).passthrough()).min(1).max(1000),
}).passthrough();

/** @brief 创建仅供本机访问的管理 API、模型网关和 MCP 服务。 */
export function App_create(directory: string) {
  const store = Store_open(directory);
  const queue = new TaskQueue(store);
  const app = express();
  const attempts = new Map<string, { count: number; reset: number }>();
  app.disable('x-powered-by');

  // 校验 Host 与浏览器来源，阻止外部网页借助本地服务访问凭据。
  app.use((req, res, next) => {
    const hosts = [`127.0.0.1:${req.socket.localPort}`, `localhost:${req.socket.localPort}`];
    if (!hosts.includes(req.headers.host ?? '')) return next(new HttpError(403, '访问地址不在本机白名单中'));
    const origin = req.headers.origin;
    if ((origin && !hosts.some(host => origin === `http://${host}`)) || req.headers['sec-fetch-site'] === 'cross-site')
      return next(new HttpError(403, '请求来源不受信任'));
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
    if (/^\/(api|v1|mcp)(\/|$)/.test(req.path)) res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '8mb' }));

  /** @brief 获取会话令牌的哈希，不回传原始 cookie。 */
  function Session_hash(req: Request) {
    const token = req.headers.cookie?.match(/(?:^|;\s*)atelier_session=([a-f0-9]+)/)?.[1];
    return token ? Secret_hash(token) : '';
  }
  /** @brief 验证尚未过期的本地管理会话。 */
  function Session_valid(req: Request) {
    return Boolean(store.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires_at>?').get(Session_hash(req), Date.now()));
  }
  /** @brief 签发七天有效的 HttpOnly 管理会话。 */
  function Session_create(res: Response) {
    const value = randomBytes(32).toString('hex');
    store.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    store.db.prepare('INSERT INTO sessions VALUES(?,?)').run(Secret_hash(value), Date.now() + 7 * 86400000);
    res.cookie('atelier_session', value, { httpOnly: true, sameSite: 'strict', maxAge: 7 * 86400000, path: '/' });
    res.json({ authenticated: true });
  }
  /** @brief 限制管理端点只接受已登录的浏览器会话。 */
  function Admin_require(_req: Request, res: Response, next: NextFunction) {
    if (!res.locals.admin) return next(new HttpError(403, '需要管理页面登录权限'));
    next();
  }

  app.get('/api/session', (req, res) => {
    res.json({ setupRequired: !store.db.prepare("SELECT value FROM settings WHERE key='password'").get(), authenticated: Session_valid(req) });
  });
  app.post('/api/setup', (req, res) => {
    const { password } = Password_schema.parse(req.body);
    if (store.db.prepare("SELECT value FROM settings WHERE key='password'").get()) throw new HttpError(409, '管理口令已设置，请登录');
    store.db.prepare("INSERT INTO settings VALUES('password',?)").run(Password_hash(password));
    Session_create(res);
  });
  app.post('/api/login', (req, res) => {
    const { password } = Password_schema.parse(req.body);
    const key = req.socket.remoteAddress ?? 'local';
    const previous = attempts.get(key);
    const entry = previous && previous.reset > Date.now() ? previous : { count: 0, reset: Date.now() + 15 * 60000 };
    if (entry.count >= 8) throw new HttpError(429, '尝试次数过多，请稍后再试');
    const saved = store.db.prepare("SELECT value FROM settings WHERE key='password'").get();
    if (!saved || !Password_verify(password, String(saved.value))) {
      entry.count++; attempts.set(key, entry);
      throw new HttpError(401, '管理口令不正确');
    }
    attempts.delete(key);
    Session_create(res);
  });
  app.post('/api/logout', (req, res) => {
    store.db.prepare('DELETE FROM sessions WHERE hash=?').run(Session_hash(req));
    res.clearCookie('atelier_session', { path: '/' }).json({ ok: true });
  });
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });

  // Agent 令牌只开放模型和任务入口；供应商配置仍属于管理会话。
  app.use(['/api', '/v1', '/mcp'], (req, res, next) => {
    res.locals.admin = Session_valid(req);
    if (res.locals.admin) return next();
    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    const token = bearer && store.db.prepare('SELECT id FROM tokens WHERE hash=?').get(Secret_hash(bearer));
    if (!token) return next(new HttpError(401, '请登录管理页面或提供有效的访问令牌'));
    store.db.prepare('UPDATE tokens SET last_used_at=? WHERE id=?').run(new Date().toISOString(), token.id);
    next();
  });
  app.use(['/api/providers', '/api/tokens', '/api/stats', '/api/config'], Admin_require);
  app.get('/api/providers', (_req, res) => { res.json(Provider_list(store)); });
  app.post('/api/providers', (req, res) => { res.status(201).json(Provider_save(store, req.body)); });
  app.put('/api/providers/:id', (req, res) => {
    if (!Provider_list(store).some(row => row.id === req.params.id)) throw new HttpError(404, '供应商不存在');
    res.json(Provider_save(store, req.body, String(req.params.id)));
  });
  app.delete('/api/providers/:id', (req, res) => { Provider_remove(store, String(req.params.id)); res.json({ ok: true }); });
  app.post('/api/providers/:id/sync', async (req, res) => { res.json(await Provider_sync(store, String(req.params.id))); });
  app.post('/api/providers/:id/test', async (req, res) => { res.json(await Provider_sync(store, String(req.params.id), false)); });
  app.get('/api/models', (_req, res) => { res.json(Model_list(store, !res.locals.admin)); });
  app.patch('/api/models/:id', Admin_require, (req, res) => { Model_save(store, String(req.params.id), req.body); res.json({ ok: true }); });

  app.get('/api/tasks', (req, res) => {
    const limit = z.coerce.number().int().min(1).max(200).default(100).parse(req.query.limit);
    res.json(queue.Task_list(limit));
  });
  app.post('/api/tasks', (req, res) => { res.status(202).json(queue.Task_submit(req.body)); });
  app.get('/api/tasks/:id', (req, res) => { res.json(queue.Task_get(String(req.params.id))); });
  app.post('/api/tasks/:id/continue', (req, res) => { res.status(202).json(queue.Task_continue(String(req.params.id), req.body)); });
  app.post('/api/tasks/:id/cancel', (req, res) => { res.json(queue.Task_cancel(String(req.params.id))); });
  app.get('/api/tasks/:id/result', (req, res) => {
    const query = z.object({ round: z.coerce.number().int().positive().optional(), offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(24000).default(12000) }).parse(req.query);
    res.json(queue.Task_result(String(req.params.id), query.round, query.offset, query.limit));
  });
  app.get('/api/stats', (_req, res) => { res.json(Stats_get(store)); });
  app.get('/api/tokens', (_req, res) => {
    res.json(store.db.prepare('SELECT id,name,prefix,created_at,last_used_at FROM tokens ORDER BY created_at DESC').all());
  });
  app.post('/api/tokens', (req, res) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const token = `ma_${randomBytes(32).toString('hex')}`;
    const id = randomUUID();
    store.db.prepare('INSERT INTO tokens(id,name,hash,prefix,created_at) VALUES(?,?,?,?,?)')
      .run(id, name, Secret_hash(token), token.slice(0, 11), new Date().toISOString());
    res.status(201).json({ id, token });
  });
  app.delete('/api/tokens/:id', (req, res) => { store.db.prepare('DELETE FROM tokens WHERE id=?').run(String(req.params.id)); res.json({ ok: true }); });
  app.get('/api/config', (req, res) => {
    const base = `http://127.0.0.1:${req.socket.localPort}`;
    res.json({ baseUrl: base, mcpUrl: `${base}/mcp`, apiUrl: `${base}/v1`,
      codex: `[mcp_servers.model_atelier]\nurl = "${base}/mcp"\nbearer_token_env_var = "MODEL_ATELIER_TOKEN"`,
      omp: JSON.stringify({ mcpServers: { model_atelier: { type: 'http', url: `${base}/mcp`,
        headers: { Authorization: 'Bearer YOUR_ACCESS_TOKEN' } } } }, null, 2) });
  });

  app.get('/v1/models', (_req, res) => { res.json({ object: 'list', data: Model_list(store, true).map(model => ({
    id: model.id, object: 'model', created: 0, owned_by: model.provider_name,
    name: model.remote_id, tags: model.tags, description: model.description,
  })) }); });
  app.post('/v1/chat/completions', async (req, res, next) => {
    const input = Chat_schema.parse(req.body);
    const model = Model_resolve(store, input.model);
    const started = Date.now();
    const controller = new AbortController();
    let status = 'failed';
    let errorText: string | undefined;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    res.on('close', () => { if (!res.writableFinished) controller.abort(); });
    try {
      const upstream = await Provider_fetch(store, model.provider_id, '/chat/completions', {
        body: { ...input, model: model.remote_id }, signal: controller.signal, timeout: 600000,
      });
      if (!input.stream) {
        const result = await upstream.json();
        usage = result.usage;
        res.json(result);
      } else {
        if (!upstream.body) throw new HttpError(502, '供应商返回了空数据流');
        res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const decoder = new TextDecoder();
        let pending = '';
        // 原样转发 SSE，只旁路解析完整的数据行以提取供应商上报的用量。
        for await (const chunk of upstream.body) {
          pending += decoder.decode(chunk, { stream: true });
          const lines = pending.split('\n');
          pending = lines.pop() ?? '';
          for (const line of lines) {
            if (line.startsWith('data:') && line.slice(5).trim() !== '[DONE]') {
              try { const item = JSON.parse(line.slice(5)); if (item.usage) usage = item.usage; } catch { /* 非 JSON 事件仍会原样传递。 */ }
            }
          }
          if (!res.write(chunk)) await once(res, 'drain', { signal: controller.signal });
        }
        res.end();
      }
      status = 'succeeded';
    } catch (error) {
      status = controller.signal.aborted ? 'cancelled' : 'failed';
      errorText = error instanceof HttpError ? error.message : '供应商响应读取失败';
      if (res.headersSent) res.destroy(); else next(new HttpError(502, errorText));
    } finally { Call_record(store, model, 'api', started, status, usage, errorText); }
  });

  Mcp_mount(app, store, queue);
  app.use(['/api', '/v1'], (_req, _res, next) => { next(new HttpError(404, '接口不存在')); });
  return { app, store, queue };
}

/** @brief 在静态资源之后挂载统一错误处理，避免返回内部异常及堆栈。 */
export function App_errors(app: express.Express) {
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: { message: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') } }); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: { message: error.message } }); return; }
    const parseError = error as { type?: string };
    if (parseError?.type === 'entity.too.large') { res.status(413).json({ error: { message: '请求正文超过 8 MB' } }); return; }
    if (parseError?.type === 'entity.parse.failed') { res.status(400).json({ error: { message: '请求正文不是有效 JSON' } }); return; }
    res.status(500).json({ error: { message: '服务处理失败，请检查本地数据和服务状态' } });
  });
}
