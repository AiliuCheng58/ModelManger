import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coins,
  Search,
  Server,
  TrendingUp,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Format_date,
  Format_number,
  Format_tokens,
  type Provider as ApiProvider,
  type Model as ApiModel,
  type Stats,
} from './api.ts';
import './ModelUsageDashboard.css';

/* ============================== 类型定义 ============================== */

export type TimeRange = '1h' | '24h' | '7d' | '30d';

export type CallStatus = 'success' | 'error';

export interface CallLog {
  id: string;
  timestamp: string;
  status: CallStatus;
  endpoint: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  errorMessage?: string;
}

export interface ModelStat {
  id: string;
  name: string;
  provider: string;
  tags: string[];
  enabled: boolean;
  totalCalls: number;
  successRate: number; // 0 - 100
  avgLatencyMs: number;
  totalTokens: number;
  logs: CallLog[];
}

export interface OverviewMetrics {
  totalCalls: number;
  totalCallsTrend: number;
  successRate: number;
  successRateTrend: number;
  avgLatencyMs: number;
  avgLatencyTrend: number;
  totalTokens: number;
  totalTokensTrend: number;
}

export interface DashboardDataProps {
  providers: ApiProvider[];
  models: ApiModel[];
  stats: Stats;
}

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1 小时' },
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
];

/** 延迟分档：<500ms 绿 / 500-1500ms 黄 / >1500ms 红 */
type LatencyLevel = 'good' | 'warn' | 'danger';

function getLatencyLevel(ms: number): LatencyLevel {
  if (ms <= 0) return 'good';
  if (ms < 500) return 'good';
  if (ms <= 1500) return 'warn';
  return 'danger';
}

/* ============================== 呈现子组件 ============================== */

interface MetricCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  iconClass: string;
  trend: number;
  invertTrend?: boolean;
  suffix?: string;
}

function MetricCard({
  title,
  value,
  icon: Icon,
  iconClass,
  trend,
  invertTrend = false,
  suffix,
}: MetricCardProps) {
  const isZero = trend === 0 || !Number.isFinite(trend);
  const isPositive = trend > 0;
  const isGood = invertTrend ? !isPositive : isPositive;

  const trendClass = isZero ? 'neutral' : isGood ? 'positive' : 'negative';
  const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="mud-metric-card">
      <div className="mud-metric-head">
        <span className="mud-metric-title">{title}</span>
        <div className={`mud-metric-icon ${iconClass}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="mud-metric-body">
        <div className="mud-metric-value">
          {value}
          {suffix && <span className="mud-metric-suffix">{suffix}</span>}
        </div>
        <div className={`mud-trend-tag ${trendClass}`}>
          {!isZero && <TrendIcon size={12} />}
          <span>{isZero ? '平稳' : `${Math.abs(trend).toFixed(1)}%`}</span>
        </div>
      </div>
    </div>
  );
}

function LatencyTag({ ms }: { ms: number }) {
  if (ms <= 0) return <span className="mud-latency good">-</span>;
  const level = getLatencyLevel(ms);
  return (
    <span className={`mud-latency ${level}`}>
      <span className="mud-latency-dot" />
      {Format_number(ms)} ms
    </span>
  );
}

/* ============================== 日志抽屉 ============================== */

interface LogDrawerProps {
  model: ModelStat;
  onClose: () => void;
}

function LogDrawer({ model, onClose }: LogDrawerProps) {
  const errorCount = model.logs.filter((l) => l.status === 'error').length;

  return (
    <>
      <div className="mud-drawer-backdrop" onClick={onClose} />
      <aside className="mud-drawer" role="dialog" aria-label={`${model.name} 调用日志`}>
        <header className="mud-drawer-header">
          <div>
            <div className="mud-drawer-title">
              <Server size={16} />
              {model.name}
            </div>
            <div className="mud-drawer-sub">
              {model.provider} · 周期内 {model.logs.length} 次调用 · {errorCount} 次失败
            </div>
          </div>
          <button className="mud-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="mud-drawer-summary">
          <div className="mud-drawer-summary-item">
            <Clock size={14} /> 平均延迟 <LatencyTag ms={model.avgLatencyMs} />
          </div>
          <div className="mud-drawer-summary-item">
            <CheckCircle2 size={14} /> 成功率 <strong>{model.totalCalls > 0 ? `${model.successRate.toFixed(1)}%` : '暂无'}</strong>
          </div>
        </div>

        <div className="mud-drawer-body">
          {model.logs.length === 0 ? (
            <div className="mud-empty" style={{ padding: '40px 0' }}>
              <Clock size={24} />
              <p>该模型在当前周期内暂无调用记录</p>
            </div>
          ) : (
            <table className="mud-log-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>来源</th>
                  <th>延迟</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {model.logs.map((log) => (
                  <tr key={log.id} className={log.status === 'error' ? 'is-error' : ''}>
                    <td className="mud-log-time">{log.timestamp}</td>
                    <td>
                      {log.status === 'success' ? (
                        <span className="mud-status success" title="成功">
                          <CheckCircle2 size={13} /> 成功
                        </span>
                      ) : (
                        <span className="mud-status error" title={log.errorMessage}>
                          <AlertTriangle size={13} /> 失败
                        </span>
                      )}
                      {log.errorMessage && <div className="mud-log-error-msg">{log.errorMessage}</div>}
                    </td>
                    <td className="mud-log-endpoint">{log.endpoint}</td>
                    <td>
                      <LatencyTag ms={log.latencyMs} />
                    </td>
                    <td className="mud-log-tokens">
                      {log.inputTokens || log.outputTokens ? `${Format_number(log.inputTokens)} / ${Format_number(log.outputTokens)}` : '未上报'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </aside>
    </>
  );
}

/* ============================== 主组件 ============================== */

export function ModelUsageDashboard({ data }: { data?: DashboardDataProps }) {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [search, setSearch] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  // 1. 根据时间范围与实际数据库数据计算各项指标（仅保留周期内有调用的活跃模型）
  const { metrics, modelStats } = useMemo(() => {
    if (!data) {
      return {
        metrics: {
          totalCalls: 0,
          totalCallsTrend: 0,
          successRate: 100,
          successRateTrend: 0,
          avgLatencyMs: 0,
          avgLatencyTrend: 0,
          totalTokens: 0,
          totalTokensTrend: 0,
        },
        modelStats: [] as ModelStat[],
      };
    }

    const now = Date.now();
    const rangeMs: Record<TimeRange, number> = {
      '1h': 3600 * 1000,
      '24h': 24 * 3600 * 1000,
      '7d': 7 * 24 * 3600 * 1000,
      '30d': 30 * 24 * 3600 * 1000,
    };
    const cutoff = now - rangeMs[timeRange];

    // 筛选当前时间范围内的调用记录
    const recentCalls = (data.stats.recent || []).filter((c) => {
      const time = new Date(c.created_at).getTime();
      return isNaN(time) || time >= cutoff;
    });

    // 统计总览指标
    const totalCalls = recentCalls.length;
    const succeededCalls = recentCalls.filter((c) => c.status === 'succeeded').length;
    const successRate = totalCalls > 0 ? (succeededCalls / totalCalls) * 100 : 100;
    const avgLatencyMs =
      totalCalls > 0
        ? Math.round(recentCalls.reduce((s, c) => s + c.duration_ms, 0) / totalCalls)
        : 0;
    const totalTokens = recentCalls.reduce(
      (s, c) => s + (c.input_tokens ?? 0) + (c.output_tokens ?? 0),
      0,
    );

    // 环比分析（对比前一相同周期）
    const prevCutoff = cutoff - rangeMs[timeRange];
    const prevCalls = (data.stats.recent || []).filter((c) => {
      const time = new Date(c.created_at).getTime();
      return time >= prevCutoff && time < cutoff;
    });
    const totalCallsTrend =
      prevCalls.length > 0
        ? ((totalCalls - prevCalls.length) / prevCalls.length) * 100
        : 0;

    const metricsResult: OverviewMetrics = {
      totalCalls,
      totalCallsTrend,
      successRate,
      successRateTrend: 0,
      avgLatencyMs,
      avgLatencyTrend: 0,
      totalTokens,
      totalTokensTrend: 0,
    };

    // 按模型名称分组仅收集当前时间范围内有调用的模型
    const modelCallsMap = new Map<string, typeof recentCalls>();
    for (const c of recentCalls) {
      const group = modelCallsMap.get(c.model_name) || [];
      group.push(c);
      modelCallsMap.set(c.model_name, group);
    }

    const list: ModelStat[] = [];
    for (const [modelName, modelCalls] of modelCallsMap.entries()) {
      const modelMeta = (data.models || []).find((m) => m.remote_id === modelName);
      const providerName = modelMeta?.provider_name || modelCalls[0]?.provider_name || '未知供应商';
      const modelSucceeded = modelCalls.filter((c) => c.status === 'succeeded').length;
      const modelSuccessRate = (modelSucceeded / modelCalls.length) * 100;
      const modelAvgLatency = Math.round(
        modelCalls.reduce((s, c) => s + c.duration_ms, 0) / modelCalls.length,
      );
      const modelTokens = modelCalls.reduce(
        (s, c) => s + (c.input_tokens ?? 0) + (c.output_tokens ?? 0),
        0,
      );

      const logs: CallLog[] = modelCalls.map((c) => ({
        id: c.id,
        timestamp: Format_date(c.created_at),
        status: c.status === 'succeeded' ? 'success' : 'error',
        endpoint: c.source === 'mcp' ? 'MCP / Agent' : c.source === 'task' ? 'Web 任务' : 'Chat API',
        latencyMs: c.duration_ms,
        inputTokens: c.input_tokens ?? 0,
        outputTokens: c.output_tokens ?? 0,
        errorMessage: c.error ?? undefined,
      }));

      list.push({
        id: modelMeta?.id || modelName,
        name: modelName,
        provider: providerName,
        tags: modelMeta?.tags || [],
        enabled: Boolean(modelMeta?.enabled ?? true),
        totalCalls: modelCalls.length,
        successRate: modelSuccessRate,
        avgLatencyMs: modelAvgLatency,
        totalTokens: modelTokens,
        logs,
      });
    }

    // 默认按照调用量从高到低排序
    list.sort((a, b) => b.totalCalls - a.totalCalls || a.name.localeCompare(b.name));

    return { metrics: metricsResult, modelStats: list };
  }, [data, timeRange]);

  // 2. 动态供应商筛选列表（基于周期内调用的模型）
  const providerOptions = useMemo(() => {
    const names = modelStats.map((m) => m.provider).filter(Boolean);
    return ['all', ...Array.from(new Set(names))];
  }, [modelStats]);

  // 3. 过滤搜索
  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modelStats.filter((m) => {
      const matchesSearch =
        !q ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.tags.some((t) => t.toLowerCase().includes(q));
      const matchesProvider = selectedProvider === 'all' || m.provider === selectedProvider;
      return matchesSearch && matchesProvider;
    });
  }, [modelStats, search, selectedProvider]);

  const selectedModel = useMemo(
    () => modelStats.find((m) => m.id === selectedModelId) ?? null,
    [modelStats, selectedModelId],
  );

  const currentRangeLabel = TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label || '24 小时';

  return (
    <div className="mud-root">
      {/* ---------- 页头：标题 + 时间范围 ---------- */}
      <header className="mud-header">
        <div>
          <h1 className="mud-title">模型用量监控</h1>
          <p className="mud-subtitle">实时追踪所选周期内实际调用过的模型指标、成功率与响应延迟</p>
        </div>
        <div className="mud-range-switch" role="tablist" aria-label="时间范围">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="tab"
              aria-selected={timeRange === opt.value}
              className={`mud-range-btn ${timeRange === opt.value ? 'active' : ''}`}
              onClick={() => {
                setTimeRange(opt.value);
                setSelectedModelId(null);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      {/* ---------- 概览指标卡片 ---------- */}
      <section className="mud-metrics-grid">
        <MetricCard
          title="周期调用次数"
          value={Format_number(metrics.totalCalls)}
          icon={Activity}
          iconClass="blue"
          trend={metrics.totalCallsTrend}
        />
        <MetricCard
          title="成功率"
          value={metrics.totalCalls > 0 ? metrics.successRate.toFixed(1) : '—'}
          suffix={metrics.totalCalls > 0 ? '%' : ''}
          icon={CheckCircle2}
          iconClass="green"
          trend={metrics.successRateTrend}
        />
        <MetricCard
          title="平均响应延迟"
          value={metrics.avgLatencyMs > 0 ? Format_number(metrics.avgLatencyMs) : '—'}
          suffix={metrics.avgLatencyMs > 0 ? 'ms' : ''}
          icon={Zap}
          iconClass="amber"
          trend={metrics.avgLatencyTrend}
          invertTrend
        />
        <MetricCard
          title="消耗 Token 数"
          value={Format_tokens(metrics.totalTokens, 0)}
          icon={Coins}
          iconClass="violet"
          trend={metrics.totalTokensTrend}
        />
      </section>

      {/* ---------- 过滤工具栏 ---------- */}
      <section className="mud-toolbar">
        <div className="mud-search-box">
          <Search size={15} />
          <input
            type="text"
            placeholder="搜索调用过的模型、供应商或标签…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="mud-icon-btn sm" onClick={() => setSearch('')} aria-label="清除搜索">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="mud-provider-filters">
          {providerOptions.map((p) => (
            <button
              key={p}
              className={`mud-chip ${selectedProvider === p ? 'active' : ''}`}
              onClick={() => setSelectedProvider(p)}
            >
              {p === 'all' ? '全部供应商' : p}
            </button>
          ))}
        </div>
      </section>

      {/* ---------- 模型明细列表 ---------- */}
      <section className="mud-model-list">
        <div className="mud-list-header">
          <span>调用模型</span>
          <span>调用量</span>
          <span>成功率</span>
          <span>平均延迟</span>
          <span>Token 消耗</span>
          <span aria-hidden />
        </div>

        {modelStats.length === 0 ? (
          <div className="mud-empty" style={{ padding: '60px 20px' }}>
            <Clock size={32} />
            <p style={{ marginTop: '12px', fontSize: '13px', fontWeight: 500, color: '#687c56' }}>
              最近 {currentRangeLabel} 内暂无模型调用记录
            </p>
            <small style={{ color: '#97a38a', marginTop: '6px', fontSize: '11px' }}>
              通过工作台、HTTP API 或 MCP 发起调用后，将在此处自动呈现模型性能与明细日志
            </small>
          </div>
        ) : filteredModels.length === 0 ? (
          <div className="mud-empty">
            <Search size={28} />
            <p>未找到匹配的模型，请调整搜索或供应商筛选条件</p>
          </div>
        ) : (
          filteredModels.map((m) => (
            <button
              key={m.id}
              className="mud-model-row"
              onClick={() => setSelectedModelId(m.id)}
              aria-expanded={selectedModelId === m.id}
            >
              <div className="mud-cell mud-cell-model">
                <div className="mud-model-avatar">{m.provider.charAt(0)}</div>
                <div>
                  <div className="mud-model-name">{m.name}</div>
                  <div className="mud-model-provider">
                    {m.provider}
                    {m.tags.length > 0 && (
                      <span style={{ marginLeft: '8px', opacity: 0.8 }}>
                        · {m.tags.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mud-cell">
                <div className="mud-cell-main">{Format_number(m.totalCalls)}</div>
                <div className="mud-cell-sub">次调用</div>
              </div>

              <div className="mud-cell mud-cell-rate">
                <div className="mud-rate-track">
                  <div
                    className={`mud-rate-fill ${m.successRate >= 99 ? 'good' : m.successRate >= 90 ? 'warn' : 'danger'}`}
                    style={{ width: `${m.successRate}%` }}
                  />
                </div>
                <span className="mud-cell-sub">{m.successRate.toFixed(1)}%</span>
              </div>

              <div className="mud-cell">
                <LatencyTag ms={m.avgLatencyMs} />
              </div>

              <div className="mud-cell">
                <div className="mud-cell-main">
                  <Coins size={14} className="mud-token-icon" />
                  {Format_tokens(m.totalTokens, 0)}
                </div>
              </div>

              <div className="mud-cell mud-cell-arrow">
                <ChevronRight size={16} />
              </div>
            </button>
          ))
        )}
      </section>

      <footer className="mud-footer">
        <TrendingUp size={13} />
        共 {filteredModels.length} 个活跃模型 · 统计周期：{currentRangeLabel}
      </footer>

      {/* ---------- 调用日志抽屉 ---------- */}
      {selectedModel && <LogDrawer model={selectedModel} onClose={() => setSelectedModelId(null)} />}
    </div>
  );
}

export default ModelUsageDashboard;
