import type { Express } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { Store } from './store.ts';
import { Model_list } from './providers.ts';
import { TaskQueue, Task_schema, Task_input } from './tasks.ts';

/** @brief 将目录及持久化任务操作注册为 MCP 工具。 */
function Mcp_create(store: Store, queue: TaskQueue) {
  const server = new McpServer({ name: 'model-atelier', version: '0.1.0' }, {
    instructions: 'Use Model_list to inspect available models and their specialties. Honor an explicitly requested model; otherwise choose from the catalog. Supply task requirements and relevant code in Task_submit. Tasks run asynchronously: inspect Task_get, then read Task_result using nextOffset until complete. Apply and verify returned code in your own workspace. Use Task_continue with feedback and updated context for revisions.',
  });
  /** @brief 将工具执行结果封装为 MCP 文本，业务错误通过工具错误返回。 */
  function Mcp_result(action: () => unknown) {
    try { return { content: [{ type: 'text' as const, text: JSON.stringify(action()) }] }; }
    catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : '操作失败' }] }; }
  }
  server.registerTool('Model_list', {
    description: 'List enabled models with IDs, provider names, specialty tags and descriptions. Select a model ID before submitting a task.',
    inputSchema: {}, annotations: { readOnlyHint: true },
  }, () => Mcp_result(() => Model_list(store, true).map(({ base_url, ...model }) => model)));
  server.registerTool('Task_submit', {
    description: 'Submit a text/code generation task to a chosen model. Include relevant source text in context. Returns a task ID immediately.',
    inputSchema: Task_schema.shape,
  }, input => Mcp_result(() => queue.Task_submit(input)));
  server.registerTool('Task_get', {
    description: 'Get task state and per-round status. Read generated content separately with Task_result. Poll running tasks at reasonable intervals.',
    inputSchema: { taskId: z.string() }, annotations: { readOnlyHint: true },
  }, ({ taskId }) => Mcp_result(() => {
    const task = queue.Task_get(taskId);
    return { ...task, turns: task.turns.map(({ prompt, context, output, ...turn }) => ({ ...turn, outputLength: output.length })) };
  }));
  server.registerTool('Task_result', {
    description: 'Read a generated result in chunks. A non-null nextOffset means more content remains. finishReason=length means the upstream output was truncated.',
    inputSchema: { taskId: z.string(), round: z.number().int().positive().optional(),
      offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(24000).default(12000) },
    annotations: { readOnlyHint: true },
  }, ({ taskId, round, offset, limit }) => Mcp_result(() => queue.Task_result(taskId, round, offset, limit)));
  server.registerTool('Task_continue', {
    description: 'Continue a completed, failed or cancelled task with feedback and updated context. Previous inputs and successful replies remain in the conversation.',
    inputSchema: { taskId: z.string(), ...Task_input.shape },
  }, ({ taskId, ...input }) => Mcp_result(() => queue.Task_continue(taskId, input)));
  server.registerTool('Task_cancel', {
    description: 'Cancel the current queued or running round of a task.',
    inputSchema: { taskId: z.string() },
  }, ({ taskId }) => Mcp_result(() => queue.Task_cancel(taskId)));
  return server;
}

/** @brief 挂载无会话 HTTP MCP 传输；任务生命周期由数据库管理。 */
export function Mcp_mount(app: Express, store: Store, queue: TaskQueue) {
  app.post('/mcp', async (req, res) => {
    const server = Mcp_create(store, queue);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => { res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed' }); });
}
