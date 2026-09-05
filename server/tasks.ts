import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError, type Store } from './store.ts';
import { Model_resolve, Provider_fetch, type Model } from './providers.ts';

export const Task_input = z.object({
  prompt: z.string().trim().min(1).max(1_000_000),
  context: z.string().max(2_000_000).default(''),
});
export const Task_schema = Task_input.extend({
  model: z.string().min(1), title: z.string().trim().max(120).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(131072).optional(),
  timeoutSeconds: z.number().int().min(10).max(3600).default(600),
});
export type Turn = { id: string; task_id: string; number: number; prompt: string; context: string;
  status: string; output: string; error: string | null; finish_reason: string | null;
  started_at: string | null; ended_at: string | null; created_at: string };
type TaskRow = { id: string; title: string; model_id: string; status: string; options: string;
  created_at: string; updated_at: string };
type Usage = { prompt_tokens?: number; completion_tokens?: number };

/** @brief 写入一次调用的统计；未上报的 token 数保持为空。 */
export function Call_record(store: Store, model: Model, source: string, started: number,
  status: string, usage?: Usage, error?: string, taskId?: string, turnId?: string) {
  const valid = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  store.db.prepare(`INSERT INTO calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), taskId ?? null, turnId ?? null, model.id, model.remote_id, model.provider_name,
    source, status, valid(usage?.prompt_tokens), valid(usage?.completion_tokens),
    Date.now() - started, error ?? null, new Date(started).toISOString(),
  );
}

/** @brief 汇总调用记录、近七日趋势以及模型使用分布。 */
export function Stats_get(store: Store) {
  return {
    totals: store.db.prepare(`SELECT COUNT(*) AS calls,
      COALESCE(SUM(status='succeeded'),0) AS succeeded,
      COALESCE(SUM(status='failed'),0) AS failed,
      COALESCE(SUM(status='cancelled'),0) AS cancelled,
      COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(AVG(duration_ms),0) AS average_ms,
      COALESCE(SUM(input_tokens IS NULL OR output_tokens IS NULL),0) AS unknown_usage FROM calls`).get(),
    daily: store.db.prepare(`SELECT substr(created_at,1,10) AS day,COUNT(*) AS calls,
      COALESCE(SUM(input_tokens+output_tokens),0) AS tokens FROM calls
      WHERE created_at >= date('now','-6 days') GROUP BY day ORDER BY day`).all(),
    models: store.db.prepare(`SELECT model_name,provider_name,COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0)+COALESCE(SUM(output_tokens),0) AS tokens,
      COALESCE(AVG(duration_ms),0) AS average_ms FROM calls GROUP BY model_id ORDER BY calls DESC LIMIT 20`).all(),
    recent: store.db.prepare('SELECT * FROM calls ORDER BY created_at DESC LIMIT 50').all(),
  };
}

/** @brief 管理持久化任务队列及正在执行的取消信号。 */
export class TaskQueue {
  private active = new Map<string, AbortController>();
  private closed = false;

  /** @brief 恢复排队任务，并标记服务中断前尚未完成的调用。 */
  constructor(private store: Store, private concurrency = 2) {
    const now = new Date().toISOString();
    store.db.prepare(`UPDATE turns SET status='failed',error='服务已重启，本轮调用中断',ended_at=? WHERE status='running'`).run(now);
    store.db.prepare(`UPDATE tasks SET status='failed',updated_at=? WHERE status='running'`).run(now);
    this.Queue_pump();
  }

  /** @brief 返回任务摘要列表；正文通过详情接口按需读取。 */
  Task_list(limit = 100) {
    return this.store.db.prepare(`SELECT t.id,t.title,t.model_id,t.status,t.created_at,t.updated_at,
      m.remote_id AS model_name,p.name AS provider_name,
      (SELECT COUNT(*) FROM turns r WHERE r.task_id=t.id) AS rounds
      FROM tasks t JOIN models m ON t.model_id=m.id JOIN providers p ON m.provider_id=p.id
      ORDER BY t.updated_at DESC LIMIT ?`).all(limit);
  }

  /** @brief 获取完整任务和按轮次排列的输入输出。 */
  Task_get(id: string) {
    const task = this.store.db.prepare(`SELECT t.*,m.remote_id AS model_name,p.name AS provider_name
      FROM tasks t JOIN models m ON t.model_id=m.id JOIN providers p ON m.provider_id=p.id WHERE t.id=?`).get(id) as unknown as (TaskRow & { model_name: string; provider_name: string }) | undefined;
    if (!task) throw new HttpError(404, '任务不存在');
    const turns = this.store.db.prepare('SELECT * FROM turns WHERE task_id=? ORDER BY number').all(id) as unknown as Turn[];
    return { ...task, turns };
  }

  /** @brief 创建任务及第一轮请求，随后交给队列异步执行。 */
  Task_submit(raw: unknown) {
    const input = Task_schema.parse(raw);
    const model = Model_resolve(this.store, input.model);
    const id = randomUUID();
    const now = new Date().toISOString();
    const options = JSON.stringify({ temperature: input.temperature, maxTokens: input.maxTokens, timeoutSeconds: input.timeoutSeconds });
    this.store.db.exec('BEGIN');
    try {
      this.store.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)')
        .run(id, input.title || input.prompt.slice(0, 70), model.id, 'queued', options, now, now);
      this.Turn_insert(id, 1, input.prompt, input.context);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.Queue_pump();
    return { id, status: 'queued' };
  }

  /** @brief 在原任务内追加一轮；单任务的各轮严格串行执行。 */
  Task_continue(id: string, raw: unknown) {
    const input = Task_input.parse(raw);
    const task = this.Task_get(id);
    if (['queued', 'running'].includes(String(task.status))) throw new HttpError(409, '请等待当前轮完成或先取消');
    Model_resolve(this.store, String(task.model_id));
    this.store.db.exec('BEGIN');
    try {
      this.Turn_insert(id, task.turns.length + 1, input.prompt, input.context);
      this.store.db.prepare("UPDATE tasks SET status='queued',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.store.db.exec('COMMIT');
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
    this.Queue_pump();
    return { id, status: 'queued', round: task.turns.length + 1 };
  }

  /** @brief 取消排队或运行中的当前轮，同时关闭上游请求。 */
  Task_cancel(id: string) {
    const task = this.Task_get(id);
    const latest = task.turns.at(-1)!;
    if (!['queued', 'running'].includes(latest.status)) return { id, status: task.status };
    this.Turn_finish(latest, 'cancelled');
    this.active.get(latest.id)?.abort();
    this.Queue_pump();
    return { id, status: 'cancelled' };
  }

  /** @brief 分段返回指定轮结果，适合 agent 控制上下文长度。 */
  Task_result(id: string, round?: number, offset = 0, limit = 12000) {
    const task = this.Task_get(id);
    const turn = round ? task.turns.find(item => item.number === round) : task.turns.at(-1);
    if (!turn) throw new HttpError(404, '任务轮次不存在');
    return { taskId: id, round: turn.number, status: turn.status, error: turn.error,
      finishReason: turn.finish_reason, text: turn.output.slice(offset, offset + limit),
      totalLength: turn.output.length, nextOffset: offset + limit < turn.output.length ? offset + limit : null };
  }

  /** @brief 停止接收新执行并等待所有上游调用退出。 */
  async Queue_close() {
    this.closed = true;
    for (const controller of this.active.values()) controller.abort();
    while (this.active.size) await new Promise(resolve => setTimeout(resolve, 10));
  }

  /** @brief 插入保留完整请求上下文的一轮任务。 */
  private Turn_insert(taskId: string, number: number, prompt: string, context: string) {
    this.store.db.prepare(`INSERT INTO turns(id,task_id,number,prompt,context,status,created_at) VALUES(?,?,?,?,?,'queued',?)`)
      .run(randomUUID(), taskId, number, prompt, context, new Date().toISOString());
  }

  /** @brief 在并发容量内按创建顺序启动队列任务。 */
  private Queue_pump() {
    while (!this.closed && this.active.size < this.concurrency) {
      const turn = this.store.db.prepare("SELECT * FROM turns WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").get() as unknown as Turn | undefined;
      if (!turn) break;
      const controller = new AbortController();
      this.active.set(turn.id, controller);
      const now = new Date().toISOString();
      this.store.db.prepare("UPDATE turns SET status='running',started_at=? WHERE id=?").run(now, turn.id);
      this.store.db.prepare("UPDATE tasks SET status='running',updated_at=? WHERE id=?").run(now, turn.task_id);
      void this.Task_run(turn, controller).finally(() => { this.active.delete(turn.id); this.Queue_pump(); });
    }
  }

  /** @brief 将各轮用户输入和成功回复组合为上游对话。 */
  private async Task_run(turn: Turn, controller: AbortController) {
    const started = Date.now();
    let model: Model | undefined;
    let usage: Usage | undefined;
    let status = 'failed';
    let message: string | undefined;
    try {
      const task = this.store.db.prepare('SELECT * FROM tasks WHERE id=?').get(turn.task_id) as unknown as TaskRow;
      model = Model_resolve(this.store, task.model_id);
      const options = JSON.parse(task.options);
      const history = this.store.db.prepare('SELECT * FROM turns WHERE task_id=? AND number<=? ORDER BY number')
        .all(turn.task_id, turn.number) as unknown as Turn[];
      const messages: { role: string; content: string }[] = [];
      for (const item of history) {
        messages.push({ role: 'user', content: item.context ? `${item.prompt}\n\n<task_context>\n${item.context}\n</task_context>` : item.prompt });
        if (item.status === 'succeeded') messages.push({ role: 'assistant', content: item.output });
      }
      const response = await Provider_fetch(this.store, model.provider_id, '/chat/completions', {
        signal: controller.signal, timeout: options.timeoutSeconds * 1000,
        body: { model: model.remote_id, messages, stream: false,
          ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
          ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}) },
      });
      const data = await response.json();
      usage = data.usage;
      const choice = data.choices?.[0];
      if (typeof choice?.message?.content !== 'string' || !choice.message.content.length)
        throw new HttpError(502, '供应商未返回文本结果，请确认所选模型支持文本对话');
      if (controller.signal.aborted) throw new Error('调用已取消');
      // 保留截断结果与 finish_reason，供调用方判断是否需要继续生成。
      this.store.db.prepare('UPDATE turns SET output=?,finish_reason=? WHERE id=?')
        .run(choice.message.content, choice.finish_reason ?? null, turn.id);
      status = 'succeeded';
      this.Turn_finish(turn, status);
    } catch (error) {
      status = controller.signal.aborted ? 'cancelled' : 'failed';
      message = error instanceof HttpError ? error.message : controller.signal.aborted ? '调用已取消' : '模型响应格式无效或读取中断';
      this.Turn_finish(turn, status, message);
    } finally {
      if (model) Call_record(this.store, model, 'task', started, status, usage, message, turn.task_id, turn.id);
    }
  }

  /** @brief 原子更新轮次及任务状态，防止取消后的旧请求覆盖新一轮。 */
  private Turn_finish(turn: Turn, status: string, error?: string) {
    const now = new Date().toISOString();
    this.store.db.exec('BEGIN');
    try {
      const changed = this.store.db.prepare(`UPDATE turns SET status=?,error=?,ended_at=? WHERE id=? AND status IN ('queued','running')`)
        .run(status, error ?? null, now, turn.id);
      if (changed.changes) this.store.db.prepare('UPDATE tasks SET status=?,updated_at=? WHERE id=?').run(status, now, turn.task_id);
      this.store.db.exec('COMMIT');
    } catch (failure) { this.store.db.exec('ROLLBACK'); throw failure; }
  }
}
