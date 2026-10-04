/**
 * 与后端接口的形状（就地声明 —— 本插件不能 import 工作区包）。
 *
 * 字段与 cloud-server 的契约一一对应；改了一边没改另一边，测试会红。
 */

/** 后端给的动作声明（菜单长什么样） */
export interface ServerAction {
  id: string
  title: string
  description?: string
  group?: string
  order?: number
  nodeTypes?: string[]
  needsPrompt?: boolean
  promptBinding?: 'none' | 'text'
  fields?: unknown[]
  [k: string]: unknown
}

/** 后端给的任务（前端把它翻译成底栏认识的 running / done） */
export interface ServerJob {
  id: string
  canvasId: string
  nodeId: string
  actionId: string
  providerId: string
  status: 'running' | 'done' | 'error'
  progress?: number
  message?: string
  result?: { ok: boolean; urls?: string[]; text?: string; error?: string; taskId?: string }
}

/** 历史里的一笔 */
export interface ServerHistoryEntry {
  id: string
  jobId: string
  canvasId: string
  nodeId: string
  actionId: string
  title: string
  kind: 'image' | 'video' | 'audio' | 'other'
  status: 'done' | 'error'
  rating: 'passed' | 'pending' | 'rejected'
  urls?: string[]
  text?: string
  prompt?: string
  createdAt: number
  finishedAt: number
  error?: string
}

/** 历史查询结果（分页 + 汇总） */
export interface ServerHistoryPage {
  items: ServerHistoryEntry[]
  total: number
  page: number
  pageSize: number
  summary: { total: number; byKind: Record<string, number> }
}

/** 历史查询条件 */
export interface HistoryQueryInput {
  page?: number
  pageSize?: number
  kind?: string
  status?: string
  rating?: string
  order?: 'asc' | 'desc'
  canvasId?: string
}

/** 注入点：默认用全局 fetch（测试换成假货，不必起服务） */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** 世界最小 EventSource 形状（浏览器 EventSource 天然满足） */
export interface EventSourceLike {
  close(): void
  addEventListener(type: string, listener: (e: { data: string }) => void): void
  onerror?: ((e: unknown) => void) | null
}

/** 一次 kv 变更事件（后端只报"哪个 key 变了"，不带值） */
export interface ChangeEvent {
  type: string
  key: string
}

export interface CloudApiOptions {
  /** 服务根地址；空串 = 与画布同源（cloud-server 托管界面时就是这样） */
  baseUrl?: string
  fetchImpl?: FetchLike
  /** SSE 工厂（测试注入假的） */
  createEventSource?: (url: string) => EventSourceLike
}

/** 拼 URL：baseUrl 末尾斜杠去掉，避免出现双斜杠 */
export function joinUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, '') + path
}
