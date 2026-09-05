import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LayoutDashboard, Layers3, PlugZap, ListTodo, KeyRound, ArrowUpRight, Plus, Activity, Coins, Timer, CheckCircle2, ArrowRight, Command, LogOut, Menu, X, AlertCircle, Sparkles, Workflow, FileCode2, CircleDot } from 'lucide-react';
import { Api_request, Format_date, Format_number, Format_tokens, type Provider, type Model, type Task, type Stats, type Token, type Config } from './api.ts';
import { Brand_mark, Busy_icon, Empty_state, Status_badge, Text_link } from './ui.tsx';
import { Model_catalog, Provider_page } from './Catalog.tsx';
import { Task_page, Task_editor } from './Tasks.tsx';
import { Access_page } from './Access.tsx';

const Navigation = [
  { id: 'overview', label: '工作台', icon: LayoutDashboard },
  { id: 'models', label: '模型目录', icon: Layers3 },
  { id: 'providers', label: '供应商', icon: PlugZap },
  { id: 'tasks', label: '任务记录', icon: ListTodo },
  { id: 'access', label: '接入配置', icon: KeyRound },
];
type Data = { providers: Provider[]; models: Model[]; tasks: Task[]; stats: Stats; tokens: Token[]; config: Config };

/** @brief 管理页面导航、会话状态、数据刷新和跨页面通知。 */
export function App() {
  const [session, setSession] = useState<{ authenticated: boolean; setupRequired: boolean } | null>(null);
  const [page, setPage] = useState(Navigation.some(item => item.id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview');
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [newTask, setNewTask] = useState<{ model?: string } | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean; time: number } | null>(null);
  const notify = useCallback((message: string, error = false) => setToast({ message, error, time: Date.now() }), []);
  const refresh = useCallback(async () => {
    const [providers, models, tasks, stats, tokens, config] = await Promise.all([
      Api_request<Provider[]>('/providers'), Api_request<Model[]>('/models'), Api_request<Task[]>('/tasks'),
      Api_request<Stats>('/stats'), Api_request<Token[]>('/tokens'), Api_request<Config>('/config'),
    ]);
    setData({ providers, models, tasks, stats, tokens, config }); setError('');
  }, []);
  useEffect(() => {
    void Api_request<{ authenticated: boolean; setupRequired: boolean }>('/session').then(setSession).catch(failure => setError(failure.message));
    const expired = () => { setSession({ authenticated: false, setupRequired: false }); setData(null); };
    const hash = () => { const value = location.hash.slice(1); if (Navigation.some(item => item.id === value)) setPage(value); };
    window.addEventListener('session-expired', expired); window.addEventListener('hashchange', hash);
    return () => { window.removeEventListener('session-expired', expired); window.removeEventListener('hashchange', hash); };
  }, []);
  useEffect(() => {
    if (!session?.authenticated) return;
    void refresh().catch(failure => setError(failure.message));
    const timer = setInterval(() => { if (!document.hidden) void refresh().catch(failure => setError(failure.message)); }, 5000);
    return () => clearInterval(timer);
  }, [session?.authenticated, refresh]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(null), toast.error ? 8000 : 3500); return () => clearTimeout(timer); } }, [toast]);
  /** @brief 切换主页面并同步可分享的页面锚点。 */
  function Page_open(value: string) { setPage(value); location.hash = value; setSelected(null); setSidebar(false); }
  /** @brief 直接进入指定任务的多轮详情。 */
  function Task_open(id: string) { setPage('tasks'); location.hash = 'tasks'; setSelected(id); setNewTask(null); void refresh().catch(failure => notify(failure.message, true)); }

  if (!session) return <div className="loading-screen"><Brand_mark />{error ? <p className="form-error">{error}</p> : <p><Busy_icon />正在连接本地工作台</p>}</div>;
  if (!session.authenticated) return <Login_page setup={session.setupRequired} completed={() => setSession({ authenticated: true, setupRequired: false })} />;
  return <div className="app-shell">
    {sidebar && <button className="sidebar-shade" aria-label="关闭导航" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}><a className="brand" href="#overview" onClick={() => Page_open('overview')}><Brand_mark /><span>Model Atelier<small>个人模型工作台</small></span></a>
      <div className="workspace-label"><span className="workspace-initial">P</span><span>Personal workspace<small>本地 · 仅自己可见</small></span><span className="workspace-dot" /></div>
      <div className="nav-label">WORKSPACE</div><nav aria-label="主导航">{Navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => Page_open(item.id)}><item.icon size={18} strokeWidth={1.6} /><span>{item.label}</span>{item.id === 'models' && <span className="nav-count">{data?.models.filter(model => model.enabled && model.available).length ?? 0}</span>}{item.id === 'tasks' && !!data?.tasks.filter(task => ['running', 'queued'].includes(task.status)).length && <span className="activity-dot" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="connection-card"><div><span className="live-dot" /><strong>本地服务已连接</strong></div><p>你的模型，你的工作节奏。</p><code>127.0.0.1:{data ? new URL(data.config.baseUrl).port : '—'}</code></div><button className="profile" onClick={async () => { try { await Api_request('/logout', 'POST'); setSession({ authenticated: false, setupRequired: false }); setData(null); } catch (failure) { notify((failure as Error).message, true); } }}><span className="profile-avatar">P</span><span>个人空间<small>退出管理页面</small></span><LogOut size={16} /></button></div>
    </aside>
    <div className="main-shell"><header className="topbar"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setSidebar(true)}><Menu size={20} /></button><span className="breadcrumb">个人空间 <span>/</span> <strong>{Navigation.find(item => item.id === page)?.label}</strong></span><div className="topbar-right"><span className="local-badge"><span className="live-dot" />本地运行</span><span className="topbar-divider" /><button className="topbar-action" onClick={() => Page_open('access')}><Command size={15} />连接 Agent<ArrowUpRight size={13} /></button></div></header>
      <main id="main-content">{error && <div className="error-banner" role="alert"><AlertCircle size={18} /><span>{error}</span><button onClick={() => { void refresh().catch(failure => setError(failure.message)); }}>重新连接</button></div>}
        {!data ? <div className="loading-state"><Busy_icon />正在整理工作台…</div> : <>
          {page === 'overview' && <Overview data={data} navigate={Page_open} createTask={() => setNewTask({})} openTask={Task_open} />}
          {page === 'models' && <Model_catalog models={data.models} providers={data.providers} notify={notify} refresh={refresh} createTask={model => setNewTask({ model })} openProviders={() => Page_open('providers')} />}
          {page === 'providers' && <Provider_page providers={data.providers} notify={notify} refresh={refresh} />}
          {page === 'tasks' && <Task_page tasks={data.tasks} selected={selected} select={setSelected} createTask={() => setNewTask({})} notify={notify} refresh={refresh} />}
          {page === 'access' && <Access_page tokens={data.tokens} config={data.config} refresh={refresh} notify={notify} />}
          {newTask && <Task_editor models={data.models} selectedModel={newTask.model} close={() => setNewTask(null)} created={Task_open} notify={notify} />}
        </>}
      </main><footer className="app-footer"><span>MODEL ATELIER</span><p>A quiet place for powerful models.</p><span>LOCAL WORKSPACE <span className="footer-dot">●</span></span></footer>
    </div>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}<span>{toast.message}</span><button aria-label="关闭通知" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </div>;
}

/** @brief 展示真实调用统计、模型准备状态和近期任务。 */
function Overview({ data, navigate, createTask, openTask }: { data: Data; navigate: (page: string) => void; createTask: () => void; openTask: (id: string) => void }) {
  const enabled = data.models.filter(model => model.enabled && model.available);
  const totals = data.stats.totals;
  const ready = [data.providers.length > 0, enabled.length > 0, data.tokens.length > 0];
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setUTCDate(date.getUTCDate() - (6 - index)); const day = date.toISOString().slice(0, 10); return { day, calls: data.stats.daily.find(item => item.day === day)?.calls ?? 0 }; });
  const maximum = Math.max(1, ...days.map(day => day.calls));
  return <>
    <section className="hero"><div className="hero-content"><span className="eyebrow"><span className="tiny-cross">✳</span> YOUR PERSONAL MODEL ATELIER</span><h1>让合适的模型，<br />接手<span>下一件事。</span></h1><p>把模型的专长，变成你的工作搭档。<br />集中管理，轻松委派，留心每一次进展。</p><div className="hero-actions"><button className="button primary" onClick={createTask}><Plus size={17} />委派新任务</button><button className="button ghost" onClick={() => navigate('models')}>探索模型目录<ArrowUpRight size={16} /></button></div></div>
      <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-label">EVERY MODEL, IN ITS ELEMENT.</div><div className="floating-card card-code"><span className="art-icon"><FileCode2 size={23} strokeWidth={1.3} /></span><div><strong>创造与实现</strong><span>CODE & DESIGN</span></div><div className="art-line" /></div><div className="floating-card card-core"><Brand_mark /><div><strong>Model Atelier</strong><span>ONE WORKSPACE</span></div><CircleDot size={15} className="art-dot" /></div><div className="floating-card card-agent"><span className="art-icon"><Workflow size={23} strokeWidth={1.3} /></span><div><strong>从想法到成果</strong><span>CONNECTED AGENTS</span></div></div><span className="art-spark spark-one">✦</span><span className="art-spark spark-two">✧</span><div className="art-bottom"><span className="live-dot" />READY FOR YOUR NEXT IDEA</div></div>
    </section>
    <div className="metrics"><Metric label="可用模型" value={String(enabled.length).padStart(2, '0')} detail={`${data.providers.length} 个供应商已连接`} icon={<Layers3 size={18} />} /><Metric label="累计调用" value={Format_number(totals.calls)} detail={`${totals.succeeded} 次完成 · ${totals.failed} 次失败`} icon={<Activity size={18} />} /><Metric label="Token 用量" value={Format_number(totals.input_tokens + totals.output_tokens)} detail={`输入 ${Format_number(totals.input_tokens)} / 输出 ${Format_number(totals.output_tokens)}`} icon={<Coins size={18} />} /><Metric label="平均响应" value={totals.calls ? (totals.average_ms / 1000).toFixed(1) : '—'} unit={totals.calls ? 's' : ''} detail={totals.calls ? `统计 ${totals.calls} 次模型调用` : '完成首次调用后显示'} icon={<Timer size={18} />} /></div>
    {ready.some(value => !value) && <div className="onboarding"><div><span className="eyebrow">MAKE IT YOURS</span><h3>三步，准备好你的工作台</h3></div><div className="onboarding-steps">{[['连接供应商', 'providers'], ['准备模型', 'models'], ['接入 Agent', 'access']].map(([label, target], index) => <button key={target} onClick={() => navigate(target)} className={ready[index] ? 'done' : ''}><span>{ready[index] ? <CheckCircle2 size={16} /> : `0${index + 1}`}</span>{label}<ArrowUpRight size={14} /></button>)}</div></div>}
    <div className="dashboard-grid"><section className="panel recent-tasks"><div className="section-heading"><h2>任务动态<span className="count">{data.tasks.length}</span></h2><Text_link click={() => navigate('tasks')}>所有任务</Text_link></div>{!data.tasks.length ? <Empty_state title="等待一个值得开始的想法" detail="你的任务进展，会在这里安静地更新。" action={<button className="text-link" onClick={createTask}>创建任务<ArrowRight size={14} /></button>} /> : <div className="recent-list">{data.tasks.slice(0, 5).map(task => <button className="recent-task" key={task.id} onClick={() => openTask(task.id)}><span className="task-file"><FileCode2 size={18} /></span><span className="recent-task-text"><strong>{task.title}</strong><small>{task.model_name} <i>·</i> {Format_date(task.updated_at)}</small></span><Status_badge status={task.status} /><ArrowUpRight className="muted" size={16} /></button>)}</div>}</section>
      <section className="panel activity-panel"><div className="section-heading"><h2>调用节奏</h2><span className="muted">最近 7 天 · UTC</span></div><div className="chart-total"><strong>{days.reduce((sum, day) => sum + day.calls, 0)}</strong><span>次模型调用</span><span className="chart-key"><i />调用量</span></div><div className="bar-chart" role="img" aria-label={days.map(day => `${day.day}: ${day.calls} 次`).join('；')}><div className="chart-grid"><i /><i /><i /></div>{days.map(day => <div className="chart-column" key={day.day}><div className="bar-track"><div className={`bar ${!day.calls ? 'zero' : ''}`} style={{ height: `${day.calls ? Math.max(5, day.calls / maximum * 100) : 2}%` }} title={`${day.day}：${day.calls} 次`} /></div><span>{day.day.slice(5).replace('-', '/')}</span></div>)}</div></section></div>
    <section className="panel roster"><div className="section-heading"><h2>你的模型搭档</h2><Text_link click={() => navigate('models')}>管理模型</Text_link></div>{!enabled.length ? <div className="roster-empty"><span className="roster-symbol"><Sparkles size={22} strokeWidth={1.2} /></span><div><h3>各有所长，协作有方。</h3><p>添加模型并标注专长，让 agent 知道该把任务交给谁。</p></div><button className="button secondary small" onClick={() => navigate('providers')}>连接供应商<ArrowUpRight size={14} /></button></div> : <div className="roster-grid">{enabled.slice(0, 4).map((model, index) => <button key={model.id} className="roster-item" onClick={() => navigate('models')}><span className={`model-avatar tone-${index % 4}`}>{model.remote_id[0].toUpperCase()}</span><span><strong>{model.remote_id}</strong><small>{model.tags.slice(0, 2).join(' · ') || model.provider_name}</small></span><span className="live-dot" /></button>)}</div>}</section>
    {!!data.stats.recent.length && <section className="panel call-log"><div className="section-heading"><h2>最近调用</h2><span className="muted">{totals.unknown_usage ? `${totals.unknown_usage} 次调用未上报完整用量` : '所有用量来自供应商回报'}</span></div><div className="table-scroll"><table><thead><tr><th>模型</th><th>来源</th><th>状态</th><th>Token</th><th>耗时</th><th>时间</th></tr></thead><tbody>{data.stats.recent.slice(0, 10).map(call => <tr key={call.id}><td><span className="model-cell">{call.model_name}</span><small>{call.provider_name}</small>{call.error && <small className="error-text">{call.error}</small>}</td><td><span className="tag">{call.source === 'task' ? '任务' : 'API'}</span></td><td><Status_badge status={call.status} /></td><td>{Format_tokens(call.input_tokens, call.output_tokens)}</td><td>{(call.duration_ms / 1000).toFixed(1)}s</td><td className="nowrap">{Format_date(call.created_at)}</td></tr>)}</tbody></table></div></section>}
  </>;
}

/** @brief 以统一卡片呈现统计值及其计量口径。 */
function Metric({ label, value, detail, icon, unit }: { label: string; value: string; detail: string; icon: React.ReactNode; unit?: string }) {
  return <div className="metric"><div className="metric-label">{label}{icon}</div><div className="metric-value">{value}<span>{unit}</span></div><p>{detail}</p></div>;
}

/** @brief 首次设置管理口令，或登录已有的个人工作台。 */
function Login_page({ setup, completed }: { setup: boolean; completed: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function Login_submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (setup && password !== confirm) { setError('两次输入的口令不一致'); return; }
    setBusy(true);
    try { await Api_request(setup ? '/setup' : '/login', 'POST', { password }); completed(); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <div className="login-page"><div className="login-story"><a className="brand" href="#"><Brand_mark /><span>Model Atelier<small>个人模型工作台</small></span></a><div className="login-copy"><span className="eyebrow">A SPACE FOR YOUR MODELS</span><h1>好的工具，<br />让想法<span>走得更远。</span></h1><p>把你信任的模型聚在一起，<br />让每一份专长，都成为创作的助力。</p><div className="login-emblem"><Layers3 size={94} strokeWidth={0.7} /><span className="emblem-star">✦</span></div></div><div className="login-footer"><span className="live-dot" />LOCAL FIRST · PERSONALLY YOURS</div></div><div className="login-form-side"><form className="login-form" onSubmit={Login_submit}><span className="eyebrow">{setup ? 'LET’S GET STARTED' : 'WELCOME BACK'}</span><h2>{setup ? '准备好你的工作台' : '欢迎回到工作台'}</h2><p>{setup ? '设置一个管理口令，开始连接你的模型与 agent。' : '输入管理口令，继续你的下一件事。'}</p><label className="field">管理口令<input type="password" autoComplete={setup ? 'new-password' : 'current-password'} required minLength={8} maxLength={200} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 8 个字符" /></label>{setup && <label className="field">确认口令<input type="password" autoComplete="new-password" required value={confirm} onChange={event => setConfirm(event.target.value)} placeholder="再次输入管理口令" /></label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button primary login-submit" disabled={busy}>{busy ? <Busy_icon /> : null}{setup ? '开启我的工作台' : '进入工作台'}<ArrowRight size={16} /></button><div className="login-note"><span className="live-dot" />配置和任务记录保存在这台电脑上</div></form><span className="login-version">MODEL ATELIER / 0.1</span></div></div>;
}
