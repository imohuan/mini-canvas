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
  /** 所属平台的图标（兜底用） */
  providerIcon?: string
  /**
   * 这个动作所属平台的账号（多于一个才带；底栏据此在模型行右侧出二级菜单）。
   *
   * 账号清单来自后台的 `platforms[pid].accounts`，和动作一起下发 ——
   * 前端不再自己拼第二条来源，避免「设置页里有两个号、下拉里没有」。
   */
  accounts?: Array<{ id: string; name?: string }>
  /** 平台默认账号 id（不选号时用它） */
  defaultAccount?: string
  [k: string]: unknown
}

/** provider 声明的一个配置项（与 cloud-server 的 ProviderConfigField 同形） */
export interface ProviderConfigField {
  key: string
  label?: string
  description?: string
  type: 'string' | 'text' | 'number' | 'boolean' | 'select' | 'secret'
  default?: string | number | boolean
  options?: Array<{ label: string; value: string }>
  placeholder?: string
  min?: number
  max?: number
  step?: number
}

/** GET /api/providers 的一行（secret 值已由后台掩掉） */
export interface ProviderRow {
  id: string
  file: string
  /** 内置平台（没有文件）：界面上只读 */
  builtin?: boolean
  /** 平台自己的名字 / 介绍 / 图标（provider 没写时缺省） */
  title?: string
  description?: string
  icon?: string
  enabled: boolean
  actions: number
  config: ProviderConfigField[]
  /** 账号级字段的 key 列表（其余字段是平台通用） */
  accountFields?: string[]
  /** 平台通用值（secret 已掩码） */
  shared?: Record<string, string | number | boolean>
  accounts: Array<{
    id: string
    name?: string
    /** 默认账号：不选号时用它 */
    default?: boolean
    values: Record<string, string | number | boolean>
  }>
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
  kind: 'image' | 'video' | 'audio' | 'text' | 'other'
  status: 'done' | 'error'
  rating: 'passed' | 'pending' | 'rejected'
  urls?: string[]
  text?: string
  /** 用户当时的提示词（标签引用资源 id，普通文字单独成段） */
  prompts?: Array<{ type: 'tag' | 'prompt'; value: string }>
  /** 当时的生成参数（比例 / 时长 / 质量…） */
  values?: Record<string, unknown>
  /** 参考素材（画布内地址或文本值） */
  resources?: Array<{ id?: string; kind: string; name?: string; url?: string; value?: string }>
  /** 产物媒体元数据（尺寸 / 时长 / 字节数） */
  media?: { width?: number; height?: number; durationMs?: number; bytes?: number }
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
  /** 取消信号（切页签时丢弃过期请求；不影响服务端） */
  signal?: AbortSignal
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
  /** 画布事件额外带的画布 id（多画布过滤用）；kv 的 config/shortcut 事件没有 */
  canvasId?: string
  /** 画布图版本（提示用；最终以完整快照返回的 revision 为准） */
  revision?: number
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

/** 完整画布快照（nodes/edges 与 revision 必须来自同一次服务端读取） */
export interface CanvasSnapshotResponse {
  nodes: unknown[]
  edges: unknown[]
  view: unknown
  revision?: number
}
