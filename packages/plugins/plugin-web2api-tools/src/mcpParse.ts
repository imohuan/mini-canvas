/**
 * mcpParse —— MCP 响应的解析（纯函数，node 可单测；不认识网络）。
 *
 * 把 web2api 的 `tools/call` 结果折成内核的 ToolResult：
 * - 资源统一是 `resource` 类型，`uri` 是**相对地址**（如 /api/mcp/resources/videos/doubao/x.mp4），
 *   要用服务端 origin 补全才能被 <img>/<video> 加载；
 * - 相对地址的兜底 origin 来自 `tools/list` 的 `_meta.baseUrl`；
 * - 异步任务第一次返回时没有资源、只有 taskId（在 structuredContent 里），
 *   真实资源要等 `system/get-task`（那边是 `resources[].downloadUrl`）。
 */
import type { ToolResult } from '@mini-canvas/kernel'

/** MCP content 项（我们只消费文本与资源两种） */
export interface McpContentItem {
  type?: string
  text?: string
  resource?: { uri?: string; mimeType?: string; text?: string }
}

/** `tools/call` 的 result 形状（成功时） */
export interface McpToolCallResult {
  content?: McpContentItem[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

/** `system/get-task` 的 structuredContent 形状（我们只读需要的几个键） */
export interface McpTaskDetail {
  id?: string
  status?: string
  progress?: number
  message?: string
  resources?: Array<{ downloadUrl?: string; type?: string; name?: string }>
}

/** 把可能是相对地址的 URL 补成绝对地址（已经是 http(s)/data/blob 的原样返回） */
export function absolutize(url: string, origin?: string): string {
  const u = (url ?? '').trim()
  if (!u) return ''
  if (/^(https?:|data:|blob:)/i.test(u)) return u
  if (!origin) return u
  const base = origin.replace(/\/+$/, '')
  return u.startsWith('/') ? base + u : base + '/' + u
}

/** 从 `tools/call` 结果里抽出资源 URL（resource 类型优先，其次纯文本里的 URL） */
export function urlsFromContent(items: McpContentItem[] | undefined, origin?: string): string[] {
  const out: string[] = []
  for (const item of items ?? []) {
    if (item?.type === 'resource' && item.resource?.uri) {
      const abs = absolutize(item.resource.uri, origin)
      if (abs) out.push(abs)
      continue
    }
    if (item?.type === 'text' && item.text) {
      // 两种"文本里带地址"的形态都要认：
      // ① 直接是一串 URL；② 是 ResourceItem 的 JSON（老版服务端对 audio 这类没进
      //    resourcesToContent 分支的资源，会把对象序列化成文本发出来）。
      // 后者放宽成"resource 里带 url/uri 的 JSON" —— 免得服务端漏一个分支，客户端就悄悄收不到产物。
      const jsonUrl = urlFromJsonText(item.text)
      if (jsonUrl) {
        out.push(absolutize(jsonUrl, origin))
        continue
      }
      // 资源路由有两种前缀（/api/mcp/resources 与 /api/resources），都认
      const m = /(https?:\/\/\S+|\/(?:api\/)?(?:mcp\/)?resources\/\S+)/.exec(item.text)
      if (m) out.push(absolutize(m[1], origin))
    }
  }
  return [...new Set(out)]
}

/** 从"疑似 ResourceItem 的 JSON 文本"里取资源地址；不是 JSON / 没有地址 → 空 */
function urlFromJsonText(text: string): string {
  const s = text.trim()
  if (!s.startsWith('{')) return ''
  try {
    const obj = JSON.parse(s) as { url?: unknown; uri?: unknown; resource?: { uri?: unknown; url?: unknown } }
    const candidate = obj.url ?? obj.uri ?? obj.resource?.uri ?? obj.resource?.url
    return typeof candidate === 'string' ? candidate : ''
  } catch {
    return ''
  }
}

/** 从 content 里拼出全部文本（错误信息就在这） */
export function textFromContent(items: McpContentItem[] | undefined): string {
  return (items ?? [])
    .filter((i) => i?.type === 'text' && typeof i.text === 'string')
    .map((i) => i.text as string)
    .join('\n')
    .trim()
}

/** 完成的任务详情里的资源地址（get-task 的 resources[].downloadUrl） */
export function urlsFromTask(detail: McpTaskDetail | undefined, origin?: string): string[] {
  const out: string[] = []
  for (const r of detail?.resources ?? []) {
    if (r?.downloadUrl) {
      const abs = absolutize(r.downloadUrl, origin)
      if (abs) out.push(abs)
    }
  }
  return [...new Set(out)]
}

/** web2api 的完整任务状态词表（见 server/src/types/task.ts 的 TaskStatus） */
export type Web2ApiTaskStatus =
  | 'pending'
  | 'processing'
  | 'polling'
  | 'paused'
  | 'polling_failed'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 终态：不会再自己往前走了 */
export function isTaskDone(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

/**
 * 需要**用户处理**的中间态：任务没死、也不会自己继续。
 *
 * 为什么必须单独判：`paused`（验证码/风控/凭证失效）与 `polling_failed`（轮询中断）
 * 都不属于终态，但也不会自己往前走 —— 如果按"还在跑"处理，UI 就会**永远停在那个百分比上**
 * （用户实测反馈：任务早就 cancelled/paused 了，卡片还卡在 40%）。
 * 这里把它们收敛成"停住了、要你决定"，并给出可读原因。
 */
export function isTaskStalled(status: string | undefined): boolean {
  return status === 'paused' || status === 'polling_failed'
}

/**
 * 把 `tools/call` 结果折成内核 ToolResult。
 * 异步操作第一次返回没有资源：此时给 `{ok:true, taskId}`，由 run 返回轮询函数继续等。
 */
export function resultFromCall(
  result: McpToolCallResult | undefined,
  origin?: string,
): ToolResult {
  if (!result) return { ok: false, error: 'web2api 返回为空' }
  if (result.isError) {
    const msg = textFromContent(result.content) || '工具执行失败'
    return { ok: false, error: msg.replace(/^错误：/, '') }
  }
  const taskId = typeof result.structuredContent?.taskId === 'string' ? (result.structuredContent.taskId as string) : undefined
  const urls = urlsFromContent(result.content, origin)
  const text = textFromContent(result.content)
  if (urls.length > 0) return { ok: true, urls, taskId, text: text || undefined }
  if (taskId) return { ok: true, taskId, text: text || undefined }
  // 没有资源也没有 taskId：多半是纯文本结果（对话类）
  if (text) return { ok: true, text }
  return { ok: false, error: 'web2api 没有返回可用结果' }
}
