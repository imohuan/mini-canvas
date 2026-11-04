/**
 * 读「发送中显示队列」开关（config/agentQueuePrefs；与 packages/ui 的 agentSettings.ts
 * 同一个键，两处别自创第二真源 —— 用户口径 2026-10-15）。
 *
 * 读不到（从未保存 / 后台没起 / 坏数据）→ 默认**显示**（保持现有行为；关掉是用户显式的选择）。
 * 任何情况不抛 —— 首屏不能因为后台没起就报错。
 */
const CONFIG_BUCKET_PATH = '/api/kv/config?values=1'
export const QUEUE_PREFS_KEY = 'agentQueuePrefs'

export async function loadQueueShowSending(opts: { fetchImpl?: typeof fetch; baseUrl?: string } = {}): Promise<boolean> {
  const f = opts.fetchImpl ?? (typeof fetch === 'undefined' ? undefined : fetch)
  if (!f) return true
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  try {
    const res = await f(base + CONFIG_BUCKET_PATH, { headers: { accept: 'application/json' } })
    if (!res.ok) return true
    const body = (await res.json()) as { values?: Record<string, unknown> } | null
    const raw = body?.values?.[QUEUE_PREFS_KEY]
    if (!raw || typeof raw !== 'object' || !('showSending' in raw)) return true
    const v = (raw as { showSending?: unknown }).showSending
    return typeof v === 'boolean' ? v : true
  } catch {
    return true
  }
}
