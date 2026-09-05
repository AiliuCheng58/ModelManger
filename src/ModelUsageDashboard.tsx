import { useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  Clock,
  Coins,
  Search,
  Server,
  TrendingUp,
  X,
  Zap,
  SlidersHorizontal,
  FileCode2,
} from 'lucide-react';
import {
  Format_date,
  Format_number,
  Format_tokens,
  type Provider as ApiProvider,
  type Model as ApiModel,
  type Stats,
} from './api.ts';
import { Empty_state, Page_heading, Status_badge } from './ui.tsx';
import './ModelUsageDashboard.css';

/* ============================== 类型定义 ============================== */

export type TimeRange = '1h' | '24h' | '7d' | '30d';

export interface CallLog {
  id: string;
  timestamp: string;
  status: string;
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
  avgLatencyMs: number;
  totalTokens: number;
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

/** @brief 获取延迟分类等级 */
function getLatencyClass(ms: number): string {
  if (ms <= 0) return 'succeeded';
  if (ms < 500) return 'succeeded';
  if (ms <= 1500) return 'running';
  return 'failed';
}

/* ============================== 日志抽屉 ============================== */

function LogDrawer({ model, onClose }: { model: ModelStat; onClose: () => void }) {
  const errorCount = model.logs.filter((l) => l.status === 'failed').length;

  return (
    <>
      <div className="drawer-shade" onClick={onClose} />
      <aside className="log-drawer" role="dialog" aria-label={`${model.name} 调用记录`}>
        <header className="drawer-head">
          <div className="drawer-title-group">
            <span className="eyebrow">CALL HISTORY</span>
            <h2>{model.name}</h2>
            <div className="drawer-meta">
              <span className="model-provider-badge">{model.provider}</span>
              <span>周期内共 {model.logs.length} 次调用</span>
              {errorCount > 0 && <span className="warning-tag">{errorCount} 次失败</span>}
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="drawer-stats-row">
          <div className="drawer-stat-item">
            <span className="drawer-stat-label"><Clock size={13} /> 平均响应延迟</span>
            <strong>{model.avgLatencyMs > 0 ? `${Format_number(model.avgLatencyMs)} ms` : '—'}</strong>
          </div>
          <div className="drawer-stat-item">
            <span className="drawer-stat-label"><CheckCircle2 size={13} /> 整体成功率</span>
            <strong>{model.totalCalls > 0 ? `${model.successRate.toFixed(1)}%` : '暂无'}</strong>
          </div>
          <div className="drawer-stat-item">
            <span className="drawer-stat-label"><Coins size={13} /> Token 总消耗</span>
            <strong>{Format_tokens(model.totalTokens, 0)}</strong>
          </div>
        </div>

        <div className="drawer-body">
          {model.logs.length === 0 ? (
            <Empty_state title="暂无调用记录" detail="所选周期内未产生针对该模型的请求。" />
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>状态</th>
                    <th>调用来源</th>
                    <th>耗时</th>
                    <th>Token (入 / 出)</th>
                  </tr>
                </thead>
                <tbody>
                  {model.logs.map((log) => (
                    <tr key={log.id} className={log.status === 'failed' ? 'error-row' : ''}>
                      <td className="nowrap"><small>{log.timestamp}</small></td>
                      <td>
                        <Status_badge status={log.status} />
                        {log.errorMessage && <small className="error-detail-text">{log.errorMessage}</small>}
                      </td>
                      <td>
                        <span className="source-tag">{log.endpoint}</span>
                      </td>
                      <td className="nowrap">
                        <span className={`status ${getLatencyClass(log.latencyMs)}`}>
                          <i />{Format_number(log.latencyMs)} ms
                        </span>
                      </td>
                      <td className="nowrap">
                        <small>
                          {log.inputTokens || log.outputTokens
                            ? `${Format_number(log.inputTokens)} / ${Format_number(log.outputTokens)}`
                            : '未上报'}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          avgLatencyMs: 0,
          totalTokens: 0,
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
      avgLatencyMs,
      totalTokens,
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
        status: c.status,
        endpoint: c.source === 'mcp' ? 'MCP 协议' : c.source === 'task' ? '工作台任务' : 'Chat API',
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
    <div className="analytics-page">
      {/* 统一页面头部 */}
      <Page_heading
        eyebrow="MONITORING & METRICS"
        title="监控看板"
        description="实时追踪各模型在工作台、API 与 MCP 调用中的运行节奏、成功率与响应延迟。"
        action={
          <div className="segmented" role="tablist" aria-label="统计时间范围">
            {TIME_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="tab"
                aria-selected={timeRange === opt.value}
                className={timeRange === opt.value ? 'selected' : ''}
                onClick={() => {
                  setTimeRange(opt.value);
                  setSelectedModelId(null);
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {/* 统一指标卡片网格 */}
      <div className="metrics">
        <div className="metric">
          <div className="metric-label">
            <span>周期调用次数</span>
            <Activity size={18} />
          </div>
          <div className="metric-value">{Format_number(metrics.totalCalls)}</div>
          <p>
            {metrics.totalCallsTrend !== 0
              ? `环比 ${metrics.totalCallsTrend > 0 ? '+' : ''}${metrics.totalCallsTrend.toFixed(1)}%`
              : '与前一周期持平'}
          </p>
        </div>

        <div className="metric">
          <div className="metric-label">
            <span>成功率</span>
            <CheckCircle2 size={18} />
          </div>
          <div className="metric-value">
            {metrics.totalCalls > 0 ? `${metrics.successRate.toFixed(1)}` : '—'}
            {metrics.totalCalls > 0 && <span>%</span>}
          </div>
          <p>
            {metrics.totalCalls > 0
              ? `${Math.round((metrics.totalCalls * metrics.successRate) / 100)} 次执行成功`
              : '暂无调用'}
          </p>
        </div>

        <div className="metric">
          <div className="metric-label">
            <span>平均响应延迟</span>
            <Zap size={18} />
          </div>
          <div className="metric-value">
            {metrics.avgLatencyMs > 0 ? `${Format_number(metrics.avgLatencyMs)}` : '—'}
            {metrics.avgLatencyMs > 0 && <span>ms</span>}
          </div>
          <p>
            {metrics.avgLatencyMs <= 0
              ? '无调用耗时'
              : metrics.avgLatencyMs < 500
                ? '响应敏捷极速'
                : metrics.avgLatencyMs <= 1500
                  ? '响应平稳正常'
                  : '响应延迟较高'}
          </p>
        </div>

        <div className="metric">
          <div className="metric-label">
            <span>Token 消耗量</span>
            <Coins size={18} />
          </div>
          <div className="metric-value">{Format_tokens(metrics.totalTokens, 0)}</div>
          <p>来自供应商实际回报</p>
        </div>
      </div>

      {/* 统一筛选工具栏 */}
      <div className="catalog-toolbar">
        <div className="filters">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索模型"
              placeholder="搜索模型、供应商或专长…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="select-wrap">
            <SlidersHorizontal size={15} />
            <select
              aria-label="筛选供应商"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
            >
              <option value="all">所有活跃供应商</option>
              {providerOptions.filter((p) => p !== 'all').map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="toolbar-info">
          <TrendingUp size={14} />
          <span>共 {filteredModels.length} 个活跃模型 · 统计周期：{currentRangeLabel}</span>
        </div>
      </div>

      {/* 模型调用排行面板 */}
      <div className="panel analytics-table-panel">
        {modelStats.length === 0 ? (
          <Empty_state
            title={`最近 ${currentRangeLabel} 内暂无模型调用`}
            detail="发起任务、API 请求或通过 MCP 调用后，将在此处自动呈现模型性能与明细。"
          />
        ) : filteredModels.length === 0 ? (
          <Empty_state title="未找到匹配的模型" detail="试试其他搜索词或选择所有供应商。" />
        ) : (
          <div className="table-scroll">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>供应商</th>
                  <th>调用量</th>
                  <th>成功率</th>
                  <th>平均延迟</th>
                  <th>Token 消耗</th>
                  <th style={{ textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((m, index) => (
                  <tr
                    key={m.id}
                    className="clickable-row"
                    onClick={() => setSelectedModelId(m.id)}
                  >
                    <td>
                      <div className="model-row-identity">
                        <div className={`model-avatar-sm tone-${index % 4}`}>
                          {m.name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="model-row-name-text">
                          <strong>{m.name}</strong>
                          {m.tags.length > 0 && <small>{m.tags.join(' · ')}</small>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="model-provider-badge">{m.provider}</span>
                    </td>
                    <td>
                      <div className="call-count-cell">
                        <strong>{Format_number(m.totalCalls)}</strong>
                        <small>次调用</small>
                      </div>
                    </td>
                    <td>
                      <div className="rate-cell">
                        <div className="rate-bar-track">
                          <div
                            className={`rate-bar-fill ${m.successRate >= 98 ? 'good' : m.successRate >= 90 ? 'warn' : 'danger'}`}
                            style={{ width: `${m.successRate}%` }}
                          />
                        </div>
                        <span className="rate-value">{m.successRate.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>
                      <span className={`status ${getLatencyClass(m.avgLatencyMs)}`}>
                        <i />
                        {m.avgLatencyMs > 0 ? `${Format_number(m.avgLatencyMs)} ms` : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="token-cell">
                        <Coins size={13} />
                        {Format_tokens(m.totalTokens, 0)}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="text-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedModelId(m.id);
                        }}
                      >
                        调用明细
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 调用日志抽屉 */}
      {selectedModel && <LogDrawer model={selectedModel} onClose={() => setSelectedModelId(null)} />}
    </div>
  );
}

export default ModelUsageDashboard;
