import { useEffect, useState, type FormEvent } from 'react';
import { Plus, ArrowUpRight, CornerDownRight, Send, CircleStop, Clock3, ChevronDown, ArrowLeft, FileCode2 } from 'lucide-react';
import { Api_request, Format_date, type Task, type Model } from './api.ts';
import { Busy_icon, Copy_button, Empty_state, Modal, Page_heading, Status_badge } from './ui.tsx';

type Notify = (message: string, error?: boolean) => void;

/** @brief 提交带明确模型与项目上下文的异步生成任务。 */
export function Task_editor({ models, selectedModel, close, created, notify }: { models: Model[]; selectedModel?: string; close: () => void; created: (id: string) => void; notify: Notify }) {
  const enabled = models.filter(item => item.enabled && item.available);
  const [model, setModel] = useState(selectedModel ?? enabled[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [context, setContext] = useState('');
  const [title, setTitle] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function Task_submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await Api_request<{ id: string }>('/tasks', 'POST', { model, prompt, context, title: title || undefined, maxTokens: maxTokens ? Number(maxTokens) : undefined }); notify('任务已提交'); created(result.id); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="把下一件事交给模型" subtitle="描述任务，提供上下文，然后留一点时间给创造。" close={close}>
    {!enabled.length ? <Empty_state title="先启用一个模型" detail="在供应商页面拉取模型后，即可开始委派任务。" /> : <form onSubmit={Task_submit}>
      <label className="field">执行模型<select required value={model} onChange={event => setModel(event.target.value)}>{enabled.map(item => <option key={item.id} value={item.id}>{item.remote_id} · {item.provider_name}</option>)}</select></label>
      <label className="field">任务名称 <span className="optional">可选</span><input value={title} maxLength={120} onChange={event => setTitle(event.target.value)} placeholder="例如：设计产品首页" /></label>
      <label className="field">任务说明<textarea required rows={4} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="你希望模型完成什么？描述预期结果、风格和需要遵守的约束。" /></label>
      <details className="context-details"><summary><FileCode2 size={16} />项目上下文与生成选项<ChevronDown size={15} /></summary><label className="field">代码与参考内容<textarea className="code-input" rows={6} value={context} onChange={event => setContext(event.target.value)} placeholder="粘贴相关代码、文件内容或补充材料…" /></label><label className="field">最大输出 Token<input type="number" min={1} max={131072} value={maxTokens} onChange={event => setMaxTokens(event.target.value)} placeholder="使用模型默认值" /></label></details>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><span className="form-note"><Clock3 size={14} />提交后可在任务记录中查看</span><button className="button primary" disabled={busy}>{busy ? <Busy_icon /> : <ArrowUpRight size={16} />}提交任务</button></div>
    </form>}
  </Modal>;
}

/** @brief 展示任务列表与可持续追加反馈的多轮详情。 */
export function Task_page({ tasks, selected, select, createTask, notify, refresh }: { tasks: Task[]; selected: string | null; select: (id: string | null) => void; createTask: () => void; notify: Notify; refresh: () => Promise<void> }) {
  const [detail, setDetail] = useState<Task | null>(null);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [context, setContext] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const [filter, setFilter] = useState('all');
  const shown = tasks.filter(task => filter === 'all' || (filter === 'active' ? ['running', 'queued'].includes(task.status) : task.status === filter));
  useEffect(() => {
    let live = true;
    setDetail(null); setError(''); setFeedback(''); setContext('');
    if (!selected) return;
    async function Detail_load() {
      try { const task = await Api_request<Task>(`/tasks/${selected}`); if (live) { setDetail(task); setError(''); } }
      catch (failure) { if (live) setError((failure as Error).message); }
    }
    void Detail_load();
    const timer = setInterval(() => { if (!document.hidden) void Detail_load(); }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [selected, version]);
  async function Task_continue(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await Api_request(`/tasks/${selected}/continue`, 'POST', { prompt: feedback, context }); setVersion(value => value + 1); await refresh(); notify('已提交新一轮修改'); }
    catch (failure) { notify((failure as Error).message, true); } finally { setBusy(false); }
  }
  async function Task_cancel() {
    setBusy(true);
    try { await Api_request(`/tasks/${selected}/cancel`, 'POST'); setVersion(value => value + 1); await refresh(); notify('任务已取消'); }
    catch (failure) { notify((failure as Error).message, true); } finally { setBusy(false); }
  }
  if (selected) return <><button className="back-link" onClick={() => select(null)}><ArrowLeft size={15} />所有任务</button>{error && <p role="alert" className="form-error">{error}</p>}{!detail ? <div className="loading-state"><Busy_icon />正在读取任务…</div> : <>
    <Page_heading eyebrow="TASK WORKSPACE" title={detail.title} description={`${detail.model_name} · ${detail.provider_name} · ${Format_date(detail.created_at)}`} action={<Status_badge status={detail.status} />} />
    <div className="task-detail-meta"><span className="mono">{detail.id}</span><Copy_button value={detail.id} notify={notify} label="复制任务 ID" /><span className="spacer" /><span>{detail.turns?.length} 轮对话</span></div>
    <div className="conversation">{detail.turns?.map(turn => <article className="turn" key={turn.id}><div className="turn-number"><span>{String(turn.number).padStart(2, '0')}</span></div><div className="turn-content"><div className="turn-heading"><h3>第 {turn.number} 轮</h3><Status_badge status={turn.status} /><span className="spacer" /><span className="muted">{Format_date(turn.started_at)}</span></div>
      <div className="request-box"><span className="eyebrow">任务输入</span><p>{turn.prompt}</p>{turn.context && <details><summary>查看本轮上下文</summary><pre>{turn.context}</pre></details>}</div>
      {turn.output ? <div className="output-box"><div className="output-head"><span><FileCode2 size={16} />模型结果</span><Copy_button value={turn.output} notify={notify} label="复制结果" /></div>{turn.finish_reason === 'length' && <p className="inline-warning">本轮达到输出长度上限，可追加反馈让模型继续生成。</p>}<pre>{turn.output}</pre></div> : ['queued', 'running'].includes(turn.status) ? <div className="task-working"><Busy_icon /><div><strong>{turn.status === 'queued' ? '正在等待执行' : '模型正在处理任务'}</strong><p>结果准备好后会自动显示在这里。</p></div></div> : null}
      {turn.error && <p className="form-error">{turn.error}</p>}</div></article>)}</div>
    {['queued', 'running'].includes(detail.status) ? <div className="task-waiting"><p><Clock3 size={16} />任务在后台执行，可以继续浏览其他页面。</p><button className="button secondary" disabled={busy} onClick={Task_cancel}><CircleStop size={16} />取消当前轮</button></div> : <form className="panel followup" onSubmit={Task_continue}><div className="section-heading"><h3><CornerDownRight size={18} />继续完善</h3><span className="muted">沿用当前任务的对话上下文</span></div><textarea required aria-label="修改意见" value={feedback} onChange={event => setFeedback(event.target.value)} placeholder="把验证结果和修改意见告诉模型…" rows={3} /><details className="context-details"><summary><FileCode2 size={15} />补充最新代码或上下文<ChevronDown size={15} /></summary><textarea aria-label="补充上下文" className="code-input" rows={5} value={context} onChange={event => setContext(event.target.value)} /></details><div className="form-actions"><button className="button primary" disabled={busy}>{busy ? <Busy_icon /> : <Send size={15} />}提交修改</button></div></form>}
  </>}</>;
  return <><Page_heading eyebrow="TASK HISTORY" title="任务记录" description="每一次委派、每一轮打磨，都有迹可循。" action={<button className="button primary" onClick={createTask}><Plus size={16} />新建任务</button>} /><div className="catalog-toolbar"><div className="segmented">{[['all', '全部任务'], ['active', '进行中'], ['succeeded', '已完成'], ['failed', '失败']].map(([value, label]) => <button key={value} className={filter === value ? 'selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><span className="muted">最近 {tasks.length} 个任务</span></div>
    <div className="panel">{!shown.length ? <Empty_state title={tasks.length ? '这里暂时没有任务' : '你的下一件事，值得一个好搭档'} detail={tasks.length ? '试试其他筛选条件。' : '挑选一个合适的模型，把需求和上下文交给它。'} action={!tasks.length && <button className="button secondary" onClick={createTask}><Plus size={16} />创建第一个任务</button>} /> : <div className="table-scroll"><table><thead><tr><th>任务</th><th>执行模型</th><th>状态</th><th>轮次</th><th>更新时间</th><th /></tr></thead><tbody>{shown.map(task => <tr key={task.id}><td><button className="table-title" onClick={() => select(task.id)}>{task.title}</button><small className="mono">{task.id.slice(0, 8)}</small></td><td><span className="model-cell">{task.model_name}</span><small>{task.provider_name}</small></td><td><Status_badge status={task.status} /></td><td>{task.rounds} 轮</td><td className="muted nowrap">{Format_date(task.updated_at)}</td><td><button className="icon-button" aria-label={`查看 ${task.title}`} onClick={() => select(task.id)}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>}</div>
  </>;
}
