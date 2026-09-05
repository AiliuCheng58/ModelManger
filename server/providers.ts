import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError, Secret_decrypt, Secret_encrypt, type Store } from './store.ts';

export const Provider_schema = z.object({
  name: z.string().trim().min(1).max(80), baseUrl: z.string().url().max(2048),
  apiKey: z.string().trim().max(4096).optional(),
});
export const Model_schema = z.object({
  enabled: z.boolean(), tags: z.array(z.string().trim().min(1).max(40)).max(20),
  description: z.string().max(4000),
});
export type Model = { id: string; provider_id: string; remote_id: string; provider_name: string;
  base_url: string; enabled: number; available: number; tags: string[]; description: string };

/** @brief 将供应商地址标准化为 API 根地址。 */
export function Provider_url(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new HttpError(400, 'API 地址必须为不含凭据、查询参数的 HTTP 或 HTTPS 地址');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/v1';
  return url.toString().replace(/\/+$/, '');
}

/** @brief 返回供应商配置摘要，凭据仅以存在标记表示。 */
export function Provider_list(store: Store) {
  return store.db.prepare(`SELECT p.id, p.name, p.base_url, p.created_at, p.synced_at,
    CASE WHEN p.secret != '' THEN 1 ELSE 0 END AS has_key,
    (SELECT COUNT(*) FROM models m WHERE m.provider_id=p.id AND available=1) AS model_count
    FROM providers p WHERE p.deleted=0 ORDER BY p.created_at`).all();
}

/** @brief 新建或更新供应商，空密钥更新会保留已有凭据。 */
export function Provider_save(store: Store, raw: unknown, id: string = randomUUID()) {
  const input = Provider_schema.parse(raw);
  const existing = store.db.prepare('SELECT secret FROM providers WHERE id=? AND deleted=0').get(id);
  const secret = input.apiKey ? Secret_encrypt(store.key, input.apiKey) : String(existing?.secret ?? '');
  store.db.prepare(`INSERT INTO providers(id,name,base_url,secret,created_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,base_url=excluded.base_url,secret=excluded.secret`)
    .run(id, input.name, Provider_url(input.baseUrl), secret, new Date().toISOString());
  return { id };
}

/** @brief 删除供应商目录入口并保留历史任务引用。 */
export function Provider_remove(store: Store, id: string) {
  const busy = store.db.prepare(`SELECT t.id FROM tasks t JOIN models m ON t.model_id=m.id
    WHERE m.provider_id=? AND t.status IN ('queued','running')`).get(id);
  if (busy) throw new HttpError(409, '该供应商仍有执行中的任务，请先取消任务');
  store.db.prepare("UPDATE providers SET deleted=1,secret='' WHERE id=?").run(id);
}

/** @brief 返回可配置模型目录，可按启用状态过滤。 */
export function Model_list(store: Store, enabledOnly = false): Model[] {
  const rows = store.db.prepare(`SELECT m.*,p.name AS provider_name,p.base_url FROM models m
    JOIN providers p ON p.id=m.provider_id WHERE p.deleted=0
    ${enabledOnly ? 'AND m.enabled=1 AND m.available=1' : ''} ORDER BY p.name,m.remote_id`).all();
  return rows.map(row => ({ ...row, tags: JSON.parse(String(row.tags)) })) as Model[];
}

/** @brief 按目录 ID 或唯一远端名称定位启用模型。 */
export function Model_resolve(store: Store, id: string) {
  const models = Model_list(store, true);
  const exact = models.find(model => model.id === id);
  if (exact) return exact;
  const matches = models.filter(model => model.remote_id === id);
  if (matches.length > 1) throw new HttpError(400, '模型名称重复，请使用模型目录中的唯一 ID');
  if (!matches.length) throw new HttpError(404, '模型不存在、已停用或已从供应商下架');
  return matches[0];
}

/** @brief 更新模型专长、说明和可调用状态。 */
export function Model_save(store: Store, id: string, raw: unknown) {
  const input = Model_schema.parse(raw);
  const result = store.db.prepare('UPDATE models SET enabled=?,tags=?,description=? WHERE id=?')
    .run(Number(input.enabled), JSON.stringify(input.tags), input.description, id);
  if (!result.changes) throw new HttpError(404, '模型不存在');
}

/** @brief 从错误文本中去除当前供应商凭据。 */
export function Provider_redact(value: string, secret: string) {
  return (secret ? value.split(secret).join('[已隐藏]') : value).slice(0, 1500);
}

/** @brief 向供应商发送带超时、取消和凭据隔离的请求。 */
export async function Provider_fetch(store: Store, providerId: string, path: string,
  options: { body?: unknown; signal?: AbortSignal; timeout?: number } = {}) {
  const provider = store.db.prepare('SELECT * FROM providers WHERE id=? AND deleted=0').get(providerId);
  if (!provider) throw new HttpError(404, '供应商不存在');
  const secret = provider.secret ? Secret_decrypt(store.key, String(provider.secret)) : '';
  const signal = AbortSignal.any([AbortSignal.timeout(options.timeout ?? 30_000), ...(options.signal ? [options.signal] : [])]);
  let response: Response;
  try {
    response = await fetch(`${provider.base_url}${path}`, {
      method: options.body ? 'POST' : 'GET', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (signal.aborted) throw new HttpError(504, options.signal?.aborted ? '调用已取消' : '供应商响应超时');
    throw new HttpError(502, `连接供应商失败：${Provider_redact(error instanceof Error ? error.message : '网络错误', secret)}`);
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 4000);
    let message = body;
    try { const parsed = JSON.parse(body); message = parsed.error?.message ?? parsed.message ?? body; } catch { /* 非 JSON 错误保留文本摘要。 */ }
    throw new HttpError(502, `供应商返回 ${response.status}：${Provider_redact(String(message), secret)}`);
  }
  return response;
}

/** @brief 拉取服务端模型列表；同步时保留用户编辑的专长及启用状态。 */
export async function Provider_sync(store: Store, id: string, save = true) {
  const response = await Provider_fetch(store, id, '/models');
  const parsed = z.object({ data: z.array(z.object({ id: z.string().min(1).max(500) })) }).safeParse(await response.json());
  if (!parsed.success) throw new HttpError(502, '供应商模型列表格式无效，预期 data 数组及模型 id');
  const data = parsed.data;
  const ids = [...new Set(data.data.map(model => model.id))];
  if (save) {
    store.db.exec('BEGIN');
    try {
      store.db.prepare('UPDATE models SET available=0 WHERE provider_id=?').run(id);
      const insert = store.db.prepare(`INSERT INTO models(id,provider_id,remote_id) VALUES(?,?,?)
        ON CONFLICT(provider_id,remote_id) DO UPDATE SET available=1`);
      for (const remoteId of ids) insert.run(randomUUID(), id, remoteId);
      store.db.prepare('UPDATE providers SET synced_at=? WHERE id=?').run(new Date().toISOString(), id);
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
  }
  return { count: ids.length, synced: save };
}
