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
import './ModelUsageDashboard.css';

/* ============================== 类型定义 ============================== */

export type TimeRange = '1h' | '24h' | '7d' | '30d';

export type Provider = 'OpenAI' | 'Anthropic' | 'Google' | 'DeepSeek' | 'Qwen';

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
  provider: Provider;
  totalCalls: number;
  successRate: number;      // 0 - 100
  avgLatencyMs: number;
  totalTokens: number;
  logs: CallLog[];
}

export interface OverviewMetrics {
  totalCalls: number;
  totalCallsTrend: number;  // 环比 %，正为上升
  successRate: number;
  successRateTrend: number;
  avgLatencyMs: number;
  avgLatencyTrend: number;  // 延迟上升为负面
  totalTokens: number;
  totalTokensTrend: number;
}

/** API 数据源契约：接入真实后端时实现这两个方法即可（见组件底部注释） */
export interface ModelUsageDataSource {
  getOverview(range: TimeRange): Promise<OverviewMetrics>;
  getModelStats(range: TimeRange): Promise<ModelStat[]>;
}

interface MetricCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  iconClass: string;
  trend: number;
  /** 数值上升是否为正面（成功率上升=好，延迟上升=坏） */
  invertTrend?: boolean;
  suffix?: string;
}

/* ============================== 常量 & 工具 ============================== */

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1 小时' },
  { value: '24h', label: '24 小时' },
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
];

const PROVIDERS: Array<Provider | 'all'> = ['all', 'OpenAI', 'Anthropic', 'Google', 'DeepSeek', 'Qwen'];

/** 延迟分档：<500ms 绿 / 500-1500ms 黄 / >1500ms 红 */
type LatencyLevel = 'good' | 'warn' | 'danger';

function getLatencyLevel(ms: number): LatencyLevel {
  if (ms < 500) return 'good';
  if (ms <= 1500) return 'warn';
  return 'danger';
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/* ============================== Mock 数据层 ==============================
 * 真实接入时，用 fetch 替换 getMockDashboardData 内的逻辑，
 * 组件其余部分无需改动。
 * ====================================================================== */

const RANGE_MULTIPLIER: Record<TimeRange, number> = {
  '1h': 1,
  '24h': 22,
  '7d': 148,
  '30d': 610,
};

const BASE_MODELS: Omit<ModelStat, 'totalCalls' | 'totalTokens' | 'logs'>[] = [
  { id: 'gpt-4o', name: 'gpt-4o', provider: 'OpenAI', successRate: 99.2, avgLatencyMs: 842 },
  { id: 'gpt-4o-mini', name: 'gpt-4o-mini', provider: 'OpenAI', successRate: 99.8, avgLatencyMs: 386 },
  { id: 'claude-3-5', name: 'claude-3.5-sonnet', provider: 'Anthropic', successRate: 98.7, avgLatencyMs: 1124 },
  { id: 'claude-haiku', name: 'claude-3-haiku', provider: 'Anthropic', successRate: 99.5, avgLatencyMs: 421 },
  { id: 'gemini-pro', name: 'gemini-1.5-pro', provider: 'Google', successRate: 97.9, avgLatencyMs: 1638 },
  { id: 'deepseek-v3', name: 'deepseek-v3', provider: 'DeepSeek', successRate: 99.4, avgLatencyMs: 654 },
  { id: 'qwen-max', name: 'qwen-max', provider: 'Qwen', successRate: 96.8, avgLatencyMs: 1892 },
  { id: 'qwen-turbo', name: 'qwen-turbo', provider: 'Qwen', successRate: 99.1, avgLatencyMs: 312 },
];

const ENDPOINTS = ['/v1/chat/completions', '/v1/embeddings', '/v1/messages', '/v1/responses'];

const ERROR_MESSAGES = [
  'rate_limit_exceeded: 请求速率超限',
  'context_length_exceeded: 上下文长度超限',
  'timeout: 上游请求超时',
  'invalid_api_key: 鉴权失败',
];

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateLogs(model: BaseLogSeed, range: TimeRange): CallLog[] {
  const rand = seededRandom(model.id.charCodeAt(0) * 7 + range.length * 13);
  const count = range === '1h' ? 18 : range === '24h' ? 32 : 24;
  const logs: CallLog[] = [];
  const now = Date.now();
  const step = range === '1h' ? 3 * 60_000 : range === '24h' ? 42 * 60_000 : 3.6 * 3_600_000;

  for (let i = 0; i < count; i++) {
    const isError = rand() * 100 > model.successRate;
    const latency = Math.max(
      80,
      Math.round(model.avgLatencyMs * (0.4 + rand() * 1.6) + (isError ? rand() * 3000 : 0)),
    );
    const inputTokens = Math.round(120 + rand() * 2600);
    const outputTokens = isError ? 0 : Math.round(80 + rand() * 1800);

    logs.push({
      id: `${model.id}-log-${i}`,
      timestamp: new Date(now - i * step - rand() * step).toLocaleString('zh-CN', { hour12: false }),
      status: isError ? 'error' : 'success',
      endpoint: ENDPOINTS[Math.floor(rand() * ENDPOINTS.length)],
      latencyMs: latency,
      inputTokens,
      outputTokens,
      errorMessage: isError ? ERROR_MESSAGES[Math.floor(rand() * ERROR_MESSAGES.length)] : undefined,
    });
  }
  return logs;
}

type BaseLogSeed = Pick<ModelStat, 'id' | 'successRate' | 'avgLatencyMs'>;

interface DashboardData {
  metrics: OverviewMetrics;
  models: ModelStat[];
}

function getMockDashboardData(range: TimeRange): DashboardData {
  const mult = RANGE_MULTIPLIER[range];
  const models: ModelStat[] = BASE_MODELS.map((m, i) => {
    const baseCalls = [4200, 8800, 2600, 3100, 1900, 3400, 1200, 5400][i];
    const totalCalls = Math.round(baseCalls * mult * (0.9 + ((i * 7 + range.length) % 5) * 0.05));
    return {
      ...m,
      // 不同时间范围略有抖动
      avgLatencyMs: Math.round(m.avgLatencyMs * (0.92 + ((i + range.length) % 4) * 0.06)),
      successRate: Math.min(100, m.successRate + (((i * 3 + range.length) % 7) - 3) * 0.1),
      totalCalls,
      totalTokens: Math.round(totalCalls * (1400 + i * 120)),
      logs: generateLogs(m, range),
    };
  });

  const totalCalls = models.reduce((s, m) => s + m.totalCalls, 0);
  const totalTokens = models.reduce((s, m) => s + m.totalTokens, 0);
  const weightedLatency = Math.round(
    models.reduce((s, m) => s + m.avgLatencyMs * m.totalCalls, 0) / totalCalls,
  );
  const weightedSuccess =
    Math.round((models.reduce((s, m) => s + m.successRate * m.totalCalls, 0) / totalCalls) * 10) / 10;

  return {
    metrics: {
      totalCalls,
      totalCallsTrend: 12.4,
      successRate: weightedSuccess,
      successRateTrend: 0.6,
      avgLatencyMs: weightedLatency,
      avgLatencyTrend: -5.2,
      totalTokens,
      totalTokensTrend: 8.9,
    },
    models,
  };
}

/* ============================== 子组件 ============================== */

function MetricCard({ title, value, icon: Icon, iconClass, trend, invertTrend = false, suffix }: MetricCardProps) {
  const isPositive = invertTrend ? trend < 0 : trend > 0;
  const TrendIcon = trend >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="mud-metric-card">
      <div className="mud-metric-header">
        <div className={`mud-metric-icon ${iconClass}`}>
          <Icon size={18} strokeWidth={2} />
        </div>
        <span className={`mud-trend-badge ${isPositive ? 'positive' : 'negative'}`}>
          <TrendIcon size={13} />
          {Math.abs(trend)}%
        </span>
      </div>
      <div className="mud-metric-value">
        {value}
        {suffix && <span className="mud-metric-suffix">{suffix}</span>}
      </div>
      <div className="mud-metric-title">{title} · 较上周期</div>
    </div>
  );
}

function LatencyTag({ ms }: { ms: number }) {
  const level = getLatencyLevel(ms);
  return (
    <span className={`mud-latency-tag ${level}`}>
      <span className="mud-latency-dot" />
      {formatNumber(ms)} ms
    </span>
  );
}

/* ------------------------- 调用日志抽屉 ------------------------- */

interface LogDrawerProps {
  model: ModelStat;
  onClose: () => void;
}

function LogDrawer({ model, onClose }: LogDrawerProps) {
  const errorCount = model.logs.filter((l) => l.status === 'error').length;

  return (
    <>
      <div className="mud-drawer-overlay" onClick={onClose} />
      <aside className="mud-drawer" role="dialog" aria-label={`${model.name} 调用日志`}>
        <header className="mud-drawer-header">
          <div>
            <div className="mud-drawer-title">
              <Server size={16} />
              {model.name}
            </div>
            <div className="mud-drawer-sub">
              {model.provider} · 最近 {model.logs.length} 条调用 · {errorCount} 条失败
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
            <CheckCircle2 size={14} /> 成功率 <strong>{model.successRate.toFixed(1)}%</strong>
          </div>
        </div>

        <div className="mud-drawer-body">
          <table className="mud-log-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>状态</th>
                <th>端点</th>
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
                    {formatNumber(log.inputTokens)} / {formatNumber(log.outputTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </aside>
    </>
  );
}

/* ============================== 主组件 ============================== */

export function ModelUsageDashboard() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState<Provider | 'all'>('all');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const data = useMemo(() => getMockDashboardData(timeRange), [timeRange]);

  const filteredModels = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.models.filter((m) => {
      const matchesSearch =
        !q || m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q);
      const matchesProvider = provider === 'all' || m.provider === provider;
      return matchesSearch && matchesProvider;
    });
  }, [data.models, search, provider]);

  const selectedModel = useMemo(
    () => data.models.find((m) => m.id === selectedModelId) ?? null,
    [data.models, selectedModelId],
  );

  const { metrics } = data;

  return (
    <div className="mud-root">
      {/* ---------- 页头：标题 + 时间范围 ---------- */}
      <header className="mud-header">
        <div>
          <h1 className="mud-title">模型用量监控</h1>
          <p className="mud-subtitle">实时追踪各 AI 模型的调用量、成功率和响应延迟</p>
        </div>
        <div className="mud-range-switch" role="tablist" aria-label="时间范围">
          {TIME_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="tab"
              aria-selected={timeRange === opt.value}
              className={`mud-range-btn ${timeRange === opt.value ? 'active' : ''}`}
              onClick={() => setTimeRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </header>

      {/* ---------- 概览指标卡片 ---------- */}
      <section className="mud-metrics-grid">
        <MetricCard
          title="总调用次数"
          value={formatNumber(metrics.totalCalls)}
          icon={Activity}
          iconClass="blue"
          trend={metrics.totalCallsTrend}
        />
        <MetricCard
          title="成功率"
          value={metrics.successRate.toFixed(1)}
          suffix="%"
          icon={CheckCircle2}
          iconClass="green"
          trend={metrics.successRateTrend}
        />
        <MetricCard
          title="平均响应延迟"
          value={formatNumber(metrics.avgLatencyMs)}
          suffix="ms"
          icon={Zap}
          iconClass="amber"
          trend={metrics.avgLatencyTrend}
          invertTrend
        />
        <MetricCard
          title="消耗总 Token 数"
          value={formatTokens(metrics.totalTokens)}
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
            placeholder="搜索模型名称或供应商…"
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
          {PROVIDERS.map((p) => (
            <button
              key={p}
              className={`mud-chip ${provider === p ? 'active' : ''}`}
              onClick={() => setProvider(p)}
            >
              {p === 'all' ? '全部供应商' : p}
            </button>
          ))}
        </div>
      </section>

      {/* ---------- 模型明细列表 ---------- */}
      <section className="mud-model-list">
        <div className="mud-list-header">
          <span>模型</span>
          <span>调用量</span>
          <span>成功率</span>
          <span>平均延迟</span>
          <span>Token 消耗</span>
          <span aria-hidden />
        </div>

        {filteredModels.length === 0 && (
          <div className="mud-empty">
            <Search size={28} />
            <p>未找到匹配的模型，请调整搜索条件</p>
          </div>
        )}

        {filteredModels.map((m) => (
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
                <div className="mud-model-provider">{m.provider}</div>
              </div>
            </div>

            <div className="mud-cell">
              <div className="mud-cell-main">{formatNumber(m.totalCalls)}</div>
              <div className="mud-cell-sub">次调用</div>
            </div>

            <div className="mud-cell mud-cell-rate">
              <div className="mud-rate-track">
                <div
                  className={`mud-rate-fill ${m.successRate >= 99 ? 'good' : m.successRate >= 97 ? 'warn' : 'danger'}`}
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
                {formatTokens(m.totalTokens)}
              </div>
            </div>

            <div className="mud-cell mud-cell-arrow">
              <ChevronRight size={16} />
            </div>
          </button>
        ))}
      </section>

      <footer className="mud-footer">
        <TrendingUp size={13} />
        共 {filteredModels.length} 个模型 · 统计周期：{TIME_RANGE_OPTIONS.find((o) => o.value === timeRange)?.label}
      </footer>

      {/* ---------- 调用日志抽屉 ---------- */}
      {selectedModel && <LogDrawer model={selectedModel} onClose={() => setSelectedModelId(null)} />}
    </div>
  );
}

export default ModelUsageDashboard;

/* ============================ 接入真实后端示例 ============================
 * const apiSource: ModelUsageDataSource = {
 *   getOverview: (r) => fetch(`/api/metrics/overview?range=${r}`).then(res => res.json()),
 *   getModelStats: (r) => fetch(`/api/metrics/models?range=${r}`).then(res => res.json()),
 * };
 * 然后在组件内用 useEffect + useState（或 React Query / SWR）替换 getMockDashboardData。
 * ====================================================================== */