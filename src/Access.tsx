import { useState, type FormEvent } from 'react';
import { KeyRound, Plus, Trash2, Terminal, Check, ShieldCheck, Copy } from 'lucide-react';
import { Api_request, Format_date, type Config, type Token } from './api.ts';
import { Busy_icon, Copy_button, Empty_state, Modal, Page_heading } from './ui.tsx';

/** @brief 管理 agent 访问令牌，并生成可直接使用的客户端接入配置。 */
export function Access_page({ tokens, config, refresh, notify }: { tokens: Token[]; config: Config; refresh: () => Promise<void>; notify: (message: string, error?: boolean) => void }) {
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<Token | null>(null);
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('codex');
  const [error, setError] = useState('');
  const snippet = tab === 'codex' ? config.codex : config.omp.replace('YOUR_ACCESS_TOKEN', token || 'YOUR_ACCESS_TOKEN');
  async function Token_create(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await Api_request<{ token: string }>('/tokens', 'POST', { name }); setToken(result.token); setCreating(false); setName(''); await refresh(); notify('访问令牌已创建'); }
    catch (failure) { setError((failure as Error).message); } finally { setBusy(false); }
  }
  async function Token_remove() {
    if (!removing) return; setBusy(true);
    try { await Api_request(`/tokens/${removing.id}`, 'DELETE'); setRemoving(null); await refresh(); notify('访问令牌已撤销'); }
    catch (failure) { notify((failure as Error).message, true); } finally { setBusy(false); }
  }
  return <><Page_heading eyebrow="CONNECT YOUR AGENTS" title="接入配置" description="给 agent 一把钥匙，让模型成为它的工作伙伴。" action={<button className="button primary" onClick={() => setCreating(true)}><Plus size={16} />创建令牌</button>} />
    <div className="endpoint-grid"><div className="panel endpoint"><span className="eyebrow">MCP ENDPOINT</span><div><code>{config.mcpUrl}</code><Copy_button value={config.mcpUrl} notify={notify} /></div><p>供 Codex、oh my pi 等 agent 调用任务工具。</p></div><div className="panel endpoint"><span className="eyebrow">OPENAI COMPATIBLE API</span><div><code>{config.apiUrl}</code><Copy_button value={config.apiUrl} notify={notify} /></div><p>统一模型目录与 Chat Completions 调用入口。</p></div></div>
    {token && <div className="token-reveal"><ShieldCheck size={21} /><div><strong>新令牌已准备好</strong><p>完整令牌仅在创建时显示，请复制保存。</p><code>{token}</code></div><Copy_button value={token} notify={notify} label="复制令牌" /><button className="button small ghost" onClick={() => setToken('')}>已保存</button></div>}
    <section className="panel"><div className="section-heading"><h2>访问令牌 <span className="count">{tokens.length}</span></h2><span className="muted">模型与任务调用权限</span></div>{!tokens.length ? <Empty_state title="还没有接入的 agent" detail="为每个 agent 创建独立令牌，便于查看使用情况和单独撤销。" /> : <div className="table-scroll"><table><thead><tr><th>名称</th><th>令牌</th><th>最近使用</th><th>创建时间</th><th /></tr></thead><tbody>{tokens.map(item => <tr key={item.id}><td><span className="token-name"><KeyRound size={15} />{item.name}</span></td><td><code>{item.prefix}••••</code></td><td>{Format_date(item.last_used_at)}</td><td>{Format_date(item.created_at)}</td><td><button className="icon-button danger" aria-label={`撤销 ${item.name}`} onClick={() => setRemoving(item)}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>}</section>
    <section className="panel integration"><div className="section-heading"><h2>连接你的开发助手</h2><span className="tag"><Terminal size={13} />Streamable HTTP</span></div><div className="integration-body"><div className="integration-guide"><div className="step"><span>01</span><div><h3>创建访问令牌</h3><p>使用上方的「创建令牌」，为客户端命名。</p></div></div><div className="step"><span>02</span><div><h3>添加 MCP 配置</h3><p>{tab === 'codex' ? '把右侧配置加入 ~/.codex/config.toml，并设置 MODEL_ATELIER_TOKEN 环境变量。' : '把右侧配置加入 ~/.omp/agent/mcp.json，将 YOUR_ACCESS_TOKEN 替换为访问令牌。'}</p></div></div><div className="step"><span>03</span><div><h3>开始委派任务</h3><p>让 agent 查看模型目录，再把具体任务交给合适的模型。</p></div></div></div><div className="code-panel"><div className="code-tabs"><button className={tab === 'codex' ? 'selected' : ''} onClick={() => setTab('codex')}>Codex</button><button className={tab === 'omp' ? 'selected' : ''} onClick={() => setTab('omp')}>oh my pi</button><span className="spacer" /><Copy_button value={snippet} notify={notify} label="复制配置" /></div><pre>{snippet}</pre>{tab === 'codex' && <div className="code-foot"><span>PowerShell 环境变量</span><code>$env:MODEL_ATELIER_TOKEN = '{token || 'YOUR_ACCESS_TOKEN'}'</code><Copy_button value={`$env:MODEL_ATELIER_TOKEN = '${token || 'YOUR_ACCESS_TOKEN'}'`} notify={notify} /></div>}</div></div></section>
    {creating && <Modal title="为 agent 创建访问令牌" close={() => setCreating(false)}><form onSubmit={Token_create}><label className="field">令牌名称<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="例如：Codex 本机" /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="button secondary" onClick={() => setCreating(false)}>取消</button><button className="button primary" disabled={busy}>{busy ? <Busy_icon /> : <KeyRound size={16} />}创建令牌</button></div></form></Modal>}
    {removing && <Modal title={`撤销 ${removing.name}`} close={() => setRemoving(null)}><p className="dialog-description">使用此令牌的客户端将无法继续访问模型和任务。可创建新令牌重新接入。</p><div className="form-actions"><button className="button secondary" onClick={() => setRemoving(null)}>取消</button><button className="button danger-fill" disabled={busy} onClick={Token_remove}>{busy ? <Busy_icon /> : <Trash2 size={16} />}撤销令牌</button></div></Modal>}
  </>;
}
