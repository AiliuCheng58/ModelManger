import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { App_create, App_errors } from '../server/app.ts';
import type { TaskQueue } from '../server/tasks.ts';

/** @brief 等待异步任务离开活动状态，超时即使检查失败。 */
async function Task_wait(queue: TaskQueue, id: string) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const result = queue.Task_get(id);
    if (!['queued', 'running'].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('测试任务等待超时');
}

test('本地供应商、权限、模型网关与 MCP 任务完整流程', async t => {
  const qaRoot = resolve('.qa');
  mkdirSync(qaRoot, { recursive: true });
  const directory = mkdtempSync(resolve(qaRoot, 'integration-'));
  const history: Record<string, any>[] = [];
  let remoteModels = ['design-model', 'slow-model', 'error-model'];
  let listInvalid = false;
  const mock = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer sk-fixture-key');
    if (req.url === '/v1/models') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(listInvalid ? { items: [] } : { data: remoteModels.map(id => ({ id })) })); return;
    }
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text); history.push(body);
    if (body.model === 'error-model') { res.writeHead(429); res.end(JSON.stringify({ error: { message: 'Limited sk-fixture-key' } })); return; }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
      res.write('data: {"usage":{"prompt_');
      res.end('tokens":4,"completion_tokens":6},"choices":[]}\n\ndata: [DONE]\n\n'); return;
    }
    const finish = () => {
      if (!res.destroyed) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({
        id: 'fixture-completion', object: 'chat.completion', model: body.model,
        choices: [{ message: { role: 'assistant', content: `Generated round ${body.messages.filter((m: any) => m.role === 'user').length}` }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      })); }
    };
    if (body.model === 'slow-model') { const timer = setTimeout(finish, 1800); res.on('close', () => clearTimeout(timer)); }
    else finish();
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const mockPort = (mock.address() as { port: number }).port;
  const { app, queue, store } = App_create(directory);
  App_errors(app);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  let token = '';
  let providerId = '';
  let models: any[] = [];
  let client: Client | undefined;
  /** @brief 发出管理端或 agent 请求，保持凭据在测试内存中。 */
  async function Api_call(path: string, method = 'GET', body?: unknown, agent = false) {
    const response = await fetch(`${base}${path}`, { method,
      headers: { 'Content-Type': 'application/json', Origin: base, ...(agent ? { Authorization: `Bearer ${token}` } : cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, data: await response.json() };
  }
  t.after(async () => {
    await client?.close();
    await queue.Queue_close();
    server.closeAllConnections(); server.close();
    mock.closeAllConnections(); mock.close();
    store.db.close();
    // 仅清理由本次检查创建且已解析到工作目录内的临时数据。
    assert.ok(resolve(directory).startsWith(qaRoot + sep));
    rmSync(directory, { recursive: true, force: true });
  });

  await t.test('管理初始化、来源限制与令牌权限', async () => {
    assert.equal((await Api_call('/api/providers')).response.status, 401);
    assert.equal((await Api_call('/api/session')).data.setupRequired, true);
    const setup = await Api_call('/api/setup', 'POST', { password: 'fixture-password-123' });
    assert.equal(setup.response.status, 200);
    cookie = setup.response.headers.get('set-cookie')!.split(';')[0];
    assert.equal((await Api_call('/api/setup', 'POST', { password: 'second-password-123' })).response.status, 409);
    const crossOrigin = await fetch(`${base}/api/providers`, { headers: { Cookie: cookie, Origin: 'https://external.example' } });
    assert.equal(crossOrigin.status, 403);
    const created = await Api_call('/api/tokens', 'POST', { name: 'Integration agent' });
    token = created.data.token;
    assert.equal(created.response.status, 201);
    assert.equal((await Api_call('/api/providers', 'GET', undefined, true)).response.status, 403);
    assert.equal((await Api_call('/api/models', 'GET', undefined, true)).response.status, 200);
    const tokenList = (await Api_call('/api/tokens')).data;
    assert.equal(JSON.stringify(tokenList).includes(token), false);
  });
  await t.test('拉取模型、保留专长、检测下架及恢复', async () => {
    const created = await Api_call('/api/providers', 'POST', { name: 'Fixture', baseUrl: `http://127.0.0.1:${mockPort}`, apiKey: 'sk-fixture-key' });
    providerId = created.data.id;
    assert.equal(created.response.status, 201);
    assert.equal((await Api_call(`/api/providers/${providerId}/sync`, 'POST')).data.count, 3);
    assert.equal(JSON.stringify((await Api_call('/api/providers')).data).includes('sk-fixture-key'), false);
    assert.notEqual(store.db.prepare('SELECT secret FROM providers WHERE id=?').get(providerId)!.secret, 'sk-fixture-key');
    models = (await Api_call('/api/models')).data;
    const model = models.find(item => item.remote_id === 'design-model');
    assert.equal((await Api_call(`/api/models/${model.id}`, 'PATCH', { enabled: false, tags: ['design'], description: 'UI implementation' })).response.status, 200);
    await Api_call(`/api/providers/${providerId}/sync`, 'POST');
    const updated = (await Api_call('/api/models')).data.find((item: any) => item.id === model.id);
    assert.equal(updated.enabled, 0); assert.deepEqual(updated.tags, ['design']);
    assert.equal((await Api_call('/api/tasks', 'POST', { model: model.id, prompt: 'Generate' })).response.status, 404);
    await Api_call(`/api/models/${model.id}`, 'PATCH', { enabled: true, tags: ['design'], description: 'UI implementation' });
    remoteModels = ['design-model', 'error-model'];
    await Api_call(`/api/providers/${providerId}/sync`, 'POST');
    assert.equal((await Api_call('/v1/models', 'GET', undefined, true)).data.data.length, 2);
    listInvalid = true;
    assert.equal((await Api_call(`/api/providers/${providerId}/sync`, 'POST')).response.status, 502);
    assert.equal((await Api_call('/v1/models', 'GET', undefined, true)).data.data.length, 2);
    listInvalid = false; remoteModels.push('slow-model');
    await Api_call(`/api/providers/${providerId}/sync`, 'POST');
  });
  await t.test('异步任务保存多轮输入输出并支持分段结果', async () => {
    const created = await Api_call('/api/tasks', 'POST', { model: 'design-model', prompt: 'Create a page', context: 'source code here', maxTokens: 500 }, true);
    assert.equal(created.response.status, 202);
    const task = await Task_wait(queue, created.data.id);
    assert.equal(task.status, 'succeeded'); assert.equal(task.turns[0].output, 'Generated round 1');
    assert.ok(history.at(-1)!.messages[0].content.includes('source code here'));
    assert.equal(history.at(-1)!.max_tokens, 500);
    const continued = await Api_call(`/api/tasks/${task.id}/continue`, 'POST', { prompt: 'Improve spacing', context: 'updated source' }, true);
    assert.equal(continued.response.status, 202);
    const next = await Task_wait(queue, task.id);
    assert.equal(next.turns.length, 2); assert.equal(next.turns[1].output, 'Generated round 2');
    assert.deepEqual(history.at(-1)!.messages.map((item: any) => item.role), ['user', 'assistant', 'user']);
    const part = await Api_call(`/api/tasks/${task.id}/result?round=1&limit=5`, 'GET', undefined, true);
    assert.equal(part.data.text, 'Gener'); assert.equal(part.data.nextOffset, 5);
    assert.equal((await Api_call('/api/stats')).data.totals.input_tokens, 20);
  });
  await t.test('取消排队和运行任务，防止旧轮次覆盖后续结果', async () => {
    const first = queue.Task_submit({ model: 'slow-model', prompt: 'First' });
    const second = queue.Task_submit({ model: 'slow-model', prompt: 'Second' });
    const third = queue.Task_submit({ model: 'slow-model', prompt: 'Third' });
    assert.equal(queue.Task_get(third.id).status, 'queued');
    assert.equal((await Api_call(`/api/tasks/${first.id}/continue`, 'POST', { prompt: 'Concurrent' })).response.status, 409);
    assert.equal((await Api_call(`/api/providers/${providerId}`, 'DELETE')).response.status, 409);
    queue.Task_cancel(third.id); queue.Task_cancel(first.id); queue.Task_cancel(second.id);
    assert.equal(queue.Task_get(third.id).status, 'cancelled');
    queue.Task_continue(first.id, { prompt: 'Try again' });
    const retried = await Task_wait(queue, first.id);
    assert.equal(retried.status, 'succeeded');
    assert.equal(retried.turns[0].status, 'cancelled'); assert.equal(retried.turns[1].status, 'succeeded');
  });
  await t.test('错误去除凭据，兼容网关转发及流式用量记录', async () => {
    const failed = queue.Task_submit({ model: 'error-model', prompt: 'Example' });
    const task = await Task_wait(queue, failed.id);
    assert.equal(task.status, 'failed'); assert.ok(task.turns[0].error!.includes('429'));
    assert.equal(task.turns[0].error!.includes('sk-fixture-key'), false);
    const chat = await Api_call('/v1/chat/completions', 'POST', { model: 'design-model', messages: [{ role: 'user', content: 'Hello' }] }, true);
    assert.equal(chat.response.status, 200); assert.equal(chat.data.choices[0].message.content, 'Generated round 1');
    const stream = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'design-model', messages: [{ role: 'user', content: 'Stream' }], stream: true, stream_options: { include_usage: true } }),
    });
    const result = await stream.text();
    assert.ok(result.includes('[DONE]')); assert.ok(result.includes('hello'));
    await new Promise(resolve => setTimeout(resolve, 30));
    const stats = (await Api_call('/api/stats')).data;
    assert.equal(stats.recent[0].input_tokens, 4); assert.equal(stats.recent[0].output_tokens, 6);
  });
  await t.test('官方 MCP 客户端可发现模型、委派任务并继续修改', async () => {
    client = new Client({ name: 'fixture-client', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    assert.equal((await client.listTools()).tools.length, 6);
    const catalog = await client.callTool({ name: 'Model_list', arguments: {} });
    assert.ok(JSON.stringify(catalog).includes('UI implementation'));
    assert.equal(JSON.stringify(catalog).includes('sk-fixture-key'), false);
    const submitted = await client.callTool({ name: 'Task_submit', arguments: { model: 'design-model', prompt: 'MCP task' } });
    const id = JSON.parse((submitted.content as { text: string }[])[0].text).id;
    await Task_wait(queue, id);
    const result = await client.callTool({ name: 'Task_result', arguments: { taskId: id } });
    assert.equal(JSON.parse((result.content as { text: string }[])[0].text).text, 'Generated round 1');
    const continued = await client.callTool({ name: 'Task_continue', arguments: { taskId: id, prompt: 'Revise' } });
    assert.equal(continued.isError, undefined);
    assert.equal((await Task_wait(queue, id)).turns.length, 2);
    const tokenId = (await Api_call('/api/tokens')).data[0].id;
    await Api_call(`/api/tokens/${tokenId}`, 'DELETE');
    assert.equal((await Api_call('/api/models', 'GET', undefined, true)).response.status, 401);
  });
});
