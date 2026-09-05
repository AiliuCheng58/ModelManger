import { useState, type FormEvent } from 'react';
import { Plus, Search, SlidersHorizontal, ArrowDownToLine, PlugZap, Pencil, Trash2, Check, Power, Server, ExternalLink } from 'lucide-react';
import { Api_request, Format_date, type Provider, type Model } from './api.ts';
import { Busy_icon, Empty_state, Modal, Page_heading, Copy_button } from './ui.tsx';

type Actions = { notify: (message: string, error?: boolean) => void; refresh: () => Promise<void> };

/** @brief 展示模型目录、供应商筛选、专长搜索和启用控制。 */
export function Model_catalog({ models, providers, notify, refresh, createTask, openProviders }: Actions & {
  models: Model[]; providers: Provider[]; createTask: (model?: string) => void; openProviders: () => void;
}) {
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Model | null>(null);
  const [busy, setBusy] = useState('');
  const shown = models.filter(model => (!provider || model.provider_id === provider) &&
    (filter !== 'enabled' || (model.enabled && model.available)) &&
    `${model.remote_id} ${model.provider_name} ${model.tags.join(' ')} ${model.description}`.toLowerCase().includes(search.toLowerCase()));
  /** @brief 同步所有供应商，并独立报告各个同步结果。 */
  async function Model_sync() {
    setBusy('sync');
    const results = await Promise.allSettled(providers.map(item => Api_request<{ count: number }>(`/providers/${item.id}/sync`, 'POST')));
    const failures = results.filter(item => item.status === 'rejected');
    notify(failures.length ? `${failures.length} 个供应商同步失败：${(failures[0] as PromiseRejectedResult).reason.message}` : '模型目录已更新', failures.length > 0);
    await refresh(); setBusy('');
  }
  /** @brief 即时更新模型可调用状态。 */
  async function Model_toggle(model: Model) {
    setBusy(model.id);
    try { await Api_request(`/models/${model.id}`, 'PATCH', { enabled: !model.enabled, tags: model.tags, description: model.description }); await refresh(); }
    catch (error) { notify((error as Error).message, true); }
    finally { setBusy(''); }
  }
  return <><Page_heading eyebrow="YOUR MODEL COLLECTION" title="模型目录" description="让每一个模型的专长，都有用武之地。" action={<button className="button primary" disabled={!providers.length || !!busy} onClick={Model_sync}>{busy === 'sync' ? <Busy_icon /> : <ArrowDownToLine size={16} />}拉取模型</button>} />
    <div className="catalog-toolbar"><div className="segmented"><button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}>全部模型 <span>{models.length}</span></button><button className={filter === 'enabled' ? 'selected' : ''} onClick={() => setFilter('enabled')}>已启用 <span>{models.filter(item => item.enabled && item.available).length}</span></button></div>
      <div className="filters"><label className="search"><Search size={16} /><input aria-label="搜索模型" placeholder="搜索模型、专长…" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="select-wrap"><SlidersHorizontal size={15} /><select aria-label="筛选供应商" value={provider} onChange={event => setProvider(event.target.value)}><option value="">所有供应商</option>{providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div></div>
    {!models.length ? <div className="panel"><Empty_state title="你的模型收藏，从这里开始" detail="连接一个供应商，拉取模型，再为它们添加专长。" action={<button className="button secondary" onClick={openProviders}><Plus size={16} />连接供应商</button>} /></div> : !shown.length ? <div className="panel"><Empty_state title="没有找到匹配的模型" detail="试试其他关键词或调整筛选条件。" /></div> : <div className="model-grid">{shown.map((model, index) => <article className={`model-card ${!model.enabled || !model.available ? 'disabled' : ''}`} key={model.id}>
      <div className="model-card-top"><div className={`model-avatar tone-${index % 4}`}>{model.remote_id.slice(0, 1).toUpperCase()}</div><button className={`toggle ${model.enabled ? 'on' : ''}`} role="switch" aria-checked={!!model.enabled} aria-label={`${model.enabled ? '停用' : '启用'} ${model.remote_id}`} disabled={!!busy || !model.available} onClick={() => Model_toggle(model)}><span /></button></div>
      <span className="model-provider">{model.provider_name}</span><h3 title={model.remote_id}>{model.remote_id}</h3><p className="model-description">{model.description || '添加说明，让 agent 更了解这个模型适合做什么。'}</p>
      <div className="tags">{model.tags.length ? model.tags.map(tag => <span key={tag}>{tag}</span>) : <span className="subtle-tag">待标注专长</span>}{!model.available && <span className="warning-tag">已下架</span>}</div>
      <div className="model-card-footer"><button className="text-link muted" onClick={() => setEditing(model)}><Pencil size={14} />编辑专长</button><button className="text-link" disabled={!model.enabled || !model.available} onClick={() => createTask(model.id)}>委派任务<ExternalLink size={14} /></button></div>
    </article>)}</div>}
    {editing && <Model_editor model={editing} close={() => setEditing(null)} notify={notify} refresh={refresh} />}
  </>;
}

/** @brief 编辑模型的专长标签与任务选择说明。 */
function Model_editor({ model, close, notify, refresh }: Actions & { model: Model; close: () => void }) {
  const [tags, setTags] = useState(model.tags.join('，'));
  const [description, setDescription] = useState(model.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function Model_submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await Api_request(`/models/${model.id}`, 'PATCH', { enabled: !!model.enabled, tags: [...new Set(tags.split(/[,，]/).map(item => item.trim()).filter(Boolean))], description }); await refresh(); notify('模型专长已保存'); close(); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <Modal title="编辑模型专长" subtitle={model.remote_id} close={close}><form onSubmit={Model_submit}><label className="field">专长标签<input value={tags} onChange={event => setTags(event.target.value)} placeholder="前端设计，代码审查，推理" /><small>用逗号分隔，agent 会据此选择合适的模型。</small></label><label className="field">模型说明<textarea rows={5} maxLength={4000} value={description} onChange={event => setDescription(event.target.value)} placeholder="描述这个模型适合的任务、擅长的风格，以及你希望 agent 了解的特点。" /></label><div className="id-row"><span>模型 ID</span><code>{model.id}</code><Copy_button value={model.id} notify={notify} /></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={busy}>{busy ? <Busy_icon /> : <Check size={16} />}保存</button></div></form></Modal>;
}

/** @brief 管理供应商地址、密钥以及模型同步操作。 */
export function Provider_page({ providers, notify, refresh }: Actions & { providers: Provider[] }) {
  const [editing, setEditing] = useState<Provider | 'new' | null>(null);
  const [removing, setRemoving] = useState<Provider | null>(null);
  const [busy, setBusy] = useState('');
  async function Provider_action(provider: Provider, action: 'test' | 'sync' | 'delete') {
    setBusy(`${provider.id}-${action}`);
    try { const result = await Api_request<{ count: number }>(`/providers/${provider.id}${action === 'delete' ? '' : `/${action}`}`, action === 'delete' ? 'DELETE' : 'POST');
      notify(action === 'delete' ? '供应商已删除' : action === 'test' ? `连接成功，可发现 ${result.count} 个模型` : `已同步 ${result.count} 个模型`); setRemoving(null); await refresh(); }
    catch (error) { notify((error as Error).message, true); } finally { setBusy(''); }
  }
  return <><Page_heading eyebrow="CONNECTED PROVIDERS" title="供应商" description="把常用的模型服务，放在同一张工作台上。" action={<button className="button primary" onClick={() => setEditing('new')}><Plus size={16} />添加供应商</button>} />
    <div className="info-strip"><PlugZap size={19} /><p>接入 OpenAI 兼容服务，填写 API 根地址即可开始。<span>支持官方接口、自定义中转服务及本地兼容服务。</span></p><span className="protocol-label">OPENAI COMPATIBLE</span></div>
    {!providers.length ? <div className="panel"><Empty_state title="连接你的第一个供应商" detail="准备好 API 地址和密钥，模型目录就能在这里汇合。" action={<button className="button secondary" onClick={() => setEditing('new')}><Plus size={16} />添加供应商</button>} /></div> : <div className="provider-list">{providers.map(provider => <article className="panel provider-card" key={provider.id}><div className="provider-main"><span className="provider-avatar"><Server size={22} /></span><div><h3>{provider.name}</h3><code>{provider.base_url}</code></div><span className="tag">{provider.model_count} 个模型</span></div><div className="provider-meta"><span><i className="dot" />{provider.has_key ? 'API 密钥已保存' : '匿名连接'}</span><span>上次同步 {Format_date(provider.synced_at)}</span></div><div className="provider-actions"><button className="button small secondary" disabled={!!busy} onClick={() => Provider_action(provider, 'test')}>{busy === `${provider.id}-test` ? <Busy_icon /> : <PlugZap size={15} />}测试连接</button><button className="button small secondary" disabled={!!busy} onClick={() => Provider_action(provider, 'sync')}>{busy === `${provider.id}-sync` ? <Busy_icon /> : <ArrowDownToLine size={15} />}拉取模型</button><span className="spacer" /><button className="icon-button" aria-label={`编辑 ${provider.name}`} onClick={() => setEditing(provider)}><Pencil size={16} /></button><button className="icon-button danger" aria-label={`删除 ${provider.name}`} onClick={() => setRemoving(provider)}><Trash2 size={16} /></button></div></article>)}</div>}
    {editing && <Provider_editor provider={editing === 'new' ? undefined : editing} close={() => setEditing(null)} notify={notify} refresh={refresh} />}
    {removing && <Modal title={`删除 ${removing.name}`} close={() => setRemoving(null)}><p className="dialog-description">该供应商的模型将从可用目录移除，已完成的任务记录会继续保留。</p><div className="form-actions"><button className="button secondary" onClick={() => setRemoving(null)}>取消</button><button className="button danger-fill" disabled={!!busy} onClick={() => Provider_action(removing, 'delete')}>{busy ? <Busy_icon /> : <Trash2 size={15} />}删除供应商</button></div></Modal>}
  </>;
}

/** @brief 在同一表单中完成供应商创建及凭据更新。 */
function Provider_editor({ provider, close, notify, refresh }: Actions & { provider?: Provider; close: () => void }) {
  const [name, setName] = useState(provider?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function Provider_submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await Api_request(`/providers${provider ? `/${provider.id}` : ''}`, provider ? 'PUT' : 'POST', { name, baseUrl, apiKey }); await refresh(); notify('供应商已保存'); close(); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  return <Modal title={provider ? '编辑供应商' : '连接一个模型服务'} subtitle="将服务添加到你的个人模型工作台。" close={close}><form onSubmit={Provider_submit}><label className="field">服务名称<input required maxLength={80} placeholder="例如：我的模型服务" value={name} onChange={event => setName(event.target.value)} /></label><label className="field">API 根地址<input required type="url" placeholder="https://api.example.com/v1" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} /><small>填写包含 API 版本的根地址，例如 /v1。</small></label><label className="field">API 密钥<input type="password" autoComplete="new-password" placeholder={provider?.has_key ? '留空保留已有密钥' : '输入服务商提供的 API Key'} value={apiKey} onChange={event => setApiKey(event.target.value)} /><small>密钥加密保存在本机后端。</small></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={busy}>{busy ? <Busy_icon /> : <Plus size={16} />}保存供应商</button></div></form></Modal>;
}
