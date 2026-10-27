/**
 * upstreamApi —— 3D 预览读"上游配置"时的数据源（纯逻辑，零 Vue / 零 DOM）。
 *
 * 背景（用户口径 2026-10-27）：上游资源的取法已经换成一个**单独的 API**，
 * 插件里还在走老的「扫边 + 认字段」方式，所以看起来没有生效。
 * 配置项见 `D:\Code\Git\mini-canvas\packages\plugins\plugin-node-3d-preview\src\node3dPreviewPlugin.ts`
 * （preview3dUpstreamApi），消费方见
 * `D:\Code\Git\mini-canvas\packages\plugins\plugin-node-3d-preview\src\PanoramaContent.vue`。
 *
 * 这里把两件事分开：
 * 1. **读画布图**（谁连进来了）：仍由宿主的能力/doc 提供；
 * 2. **读上游资源的显示配置**（地址怎么来最准）：优先问新接口；问不到再按节点字段解析。
 *
 * 接口返回的形状允许三种（真实后端常在这三种之间演进，硬认一种就会"接口调了但没效果"）：
 *   { resourceId: '...' } / { url: '...' } / { upstream: { ... } }
 *   { node: { data: { resourceId } } }
 *   { resources: [{ resourceId, url }] }
 * 只接受非空字符串；没有就返回 null（调用方回落节点字段），不猜、不拼假地址。
 */

/** 新上游接口的一条媒体（最小形状） */
export interface ResolvedUpstreamMedia {
  /** 持久资源引用 */
  resourceId?: string
  /** 可直接显示的地址 */
  url?: string
}

/** 把接口返回的任意 JSON 收成一条媒体；认不出返回 null */
export function readUpstreamMediaPayload(payload: unknown): ResolvedUpstreamMedia | null {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  // 外层常见包装：{ ok, data } / { value } / { upstream }；逐层往里找，最多两跳，避免误读无关对象。
  const candidates: unknown[] = [root]
  const data = root.data
  if (data && typeof data === 'object') candidates.push(data)
  const upstream = root.upstream
  if (upstream && typeof upstream === 'object') candidates.push(upstream)
  const value = root.value
  if (value && typeof value === 'object') candidates.push(value)
  for (const candidate of candidates) {
    const hit = mediaFromRecord(candidate)
    if (hit) return hit
  }
  // 列表形态：{ resources: [...] } / 直接数组。只看第一项 —— 本节点只消费一张图。
  const list = Array.isArray(root.resources) ? root.resources : Array.isArray(payload) ? payload : null
  if (list) {
    for (const item of list) {
      const hit = mediaFromRecord(item)
      if (hit) return hit
    }
  }
  return null
}

/** 从一个对象里取 resourceId / url（也认 data 里那一层） */
function mediaFromRecord(value: unknown): ResolvedUpstreamMedia | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  const nested = rec.data && typeof rec.data === 'object' ? (rec.data as Record<string, unknown>) : undefined
  const resourceId = firstString(rec.resourceId, rec.ref, nested?.resourceId, nested?.ref)
  const url = firstString(rec.url, rec.imageUrl, rec.src, nested?.url, nested?.imageUrl, nested?.src)
  if (!resourceId && !url) return null
  return { ...(resourceId ? { resourceId } : {}), ...(url ? { url } : {}) }
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim()
  return undefined
}

/** 接口地址里的占位符（只换这一组，不做万能模板） */
const PLACEHOLDERS: ReadonlyArray<[RegExp, (ctx: UpstreamApiContext) => string]> = [
  [/\{?canvasId\}?/g, (c) => encodeURIComponent(c.canvasId)],
  [/\{?nodeId\}?/g, (c) => encodeURIComponent(c.nodeId)],
]

export interface UpstreamApiContext {
  canvasId: string
  nodeId: string
}

/**
 * 把配置里的接口地址变成真正要请求的地址。
 *
 * 支持 `{canvasId}` / `{nodeId}` 占位；没有占位时自动补 `?canvasId=...&nodeId=...`（保留已有查询串）。
 * 留空 = 不用接口（调用方直接按节点字段解析）。
 */
export function buildUpstreamApiUrl(template: string, context: UpstreamApiContext): string {
  const raw = template.trim()
  if (!raw) return ''
  const hasCanvas = /\{?canvasId\}?/.test(raw)
  const hasNode = /\{?nodeId\}?/.test(raw)
  let url = raw
  for (const [re, value] of PLACEHOLDERS) url = url.replace(re, value(context))
  if (!hasCanvas && !hasNode) {
    const sep = url.includes('?') ? '&' : '?'
    url += sep + 'canvasId=' + encodeURIComponent(context.canvasId) + '&nodeId=' + encodeURIComponent(context.nodeId)
  }
  return url
}
