export type Provider = { id: string; name: string; base_url: string; model_count: number; has_key: number; synced_at: string | null };
export type Model = { id: string; remote_id: string; provider_id: string; provider_name: string; enabled: number; available: number; tags: string[]; description: string };
export type Task = { id: string; title: string; model_id: string; model_name: string; provider_name: string; status: string; rounds: number; created_at: string; updated_at: string; turns?: Turn[] };
export type Turn = { id: string; number: number; prompt: string; context: string; status: string; output: string; error: string | null; finish_reason: string | null; started_at: string | null; ended_at: string | null };
export type Token = { id: string; name: string; prefix: string; created_at: string; last_used_at: string | null };
export type Call = { id: string; model_name: string; provider_name: string; status: string; source: string; input_tokens: number | null; output_tokens: number | null; duration_ms: number; error: string | null; created_at: string };
export type Stats = { totals: { calls: number; succeeded: number; failed: number; cancelled: number; input_tokens: number; output_tokens: number; average_ms: number; unknown_usage: number }; daily: { day: string; calls: number; tokens: number }[]; models: { model_name: string; provider_name: string; calls: number; tokens: number; average_ms: number }[]; recent: Call[] };
export type Config = { baseUrl: string; mcpUrl: string; apiUrl: string; codex: string; omp: string };

/** @brief 调用同源管理接口，并将服务端错误转换为可显示的消息。 */
export async function Api_request<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') window.dispatchEvent(new Event('session-expired'));
    throw new Error(result.error?.message ?? '请求失败');
  }
  return result;
}

/** @brief 格式化统计数值，保留小量数据的精确值。 */
export function Format_number(value: number) { return new Intl.NumberFormat('zh-CN', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value); }
/** @brief 将时间戳显示为本地日期和时间。 */
export function Format_date(value: string | null) { return value ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '尚未使用'; }
/** @brief 显示每次请求的真实 token 用量或缺失标记。 */
export function Format_tokens(input: number | null, output: number | null) { return input === null || output === null ? '未上报' : Format_number(input + output); }
