/**
 * resourceUpload —— 把节点里的"内嵌大资源"（dataURL 图片/视频）搬到服务器，换成稳定 URL。
 *
 * 解决的问题：图片节点上传时把文件转成 dataURL 直接写进 `data.imageUrl`（"刷新不丢"的本地做法）。
 * 一个 5MB 的图变成约 6.7MB 的 base64 字符串躺在画布 JSON 里 —— 保存慢、云端存储被撑爆、
 * 多节点一多甚至能超过接口体量上限。
 *
 * 做法：扫节点 data 里的 dataURL → POST /api/files → 换回 `/uploads/<hash>.png`。
 * 服务端按内容哈希命名，所以同一张图重复上传也只占一份。
 *
 * 全部是纯函数 + 注入 fetch，node 环境可单测（不碰真实网络）。
 */

/** 上传成功后的服务端回执 */
export interface UploadedFile {
  id: string
  url: string
  size: number
  mime: string
}

/** dataURL 形状：data:<mime>[;base64],<payload> */
const DATA_URL_RE = /^data:([\w.+-]+\/[\w.+-]+)(;charset=[\w-]+)?(;base64)?,/

/** 认识这个 MIME 才搬：不认识的（比如 text/plain 混在 data 字段里）一律放过 */
const UPLOADABLE_PREFIXES = ['image/', 'video/', 'audio/', 'application/pdf']

/** 小于这个大小的 dataURL 不值得搬：一个来回的网络开销比省下的字节还贵 */
export const DEFAULT_MIN_UPLOAD_BYTES = 32 * 1024

export interface DataUrlInfo {
  mime: string
  isBase64: boolean
}

/** 解析 dataURL 头部；不是 dataURL 返回 null */
export function parseDataUrl(value: string): DataUrlInfo | null {
  const m = DATA_URL_RE.exec(value)
  if (!m) return null
  return { mime: m[1].toLowerCase(), isBase64: Boolean(m[3]) }
}

/** 这个字符串是不是"值得搬到服务器"的资源 dataURL（类型认识 + 够大） */
export function isUploadableDataUrl(value: unknown, minBytes = DEFAULT_MIN_UPLOAD_BYTES): value is string {
  if (typeof value !== 'string' || value.length < minBytes) return false
  const info = parseDataUrl(value)
  if (!info) return false
  return UPLOADABLE_PREFIXES.some((p) => info.mime.startsWith(p))
}

/** MIME → 扩展名（服务端白名单只认这些；不认识的给空串，服务端也不落扩展名） */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'application/pdf': '.pdf',
}

export function extForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase()] ?? ''
}

/**
 * dataURL → Blob。
 * 非 base64 的 dataURL 要按 URI 解码（`%20` 这类），base64 的直接 atob。
 * 环境不支持 atob（node 老版本）时抛错，由调用方兜住 —— 不静默产出坏数据。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const info = parseDataUrl(dataUrl)
  if (!info) throw new Error('[cloud-save] 不是合法的 dataURL')
  const comma = dataUrl.indexOf(',')
  const payload = dataUrl.slice(comma + 1)
  if (!info.isBase64) {
    return new Blob([decodeURIComponent(payload)], { type: info.mime })
  }
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: info.mime })
}

export interface UploadOptions {
  /** 服务根地址；空串 = 同源 */
  baseUrl?: string
  /** 注入 fetch（测试） */
  fetchImpl?: typeof fetch
  /** 原始文件名（只用于让服务端推断扩展名；真正的落盘名是内容哈希） */
  name?: string
}

/** 把一段字节传到服务器，拿回稳定 URL（`/uploads/<hash>.<ext>`）。 */
export async function uploadBlob(blob: Blob, opts: UploadOptions = {}): Promise<UploadedFile> {
  const base = (opts.baseUrl ?? '').replace(/\/+$/, '')
  const qs = opts.name ? `?name=${encodeURIComponent(opts.name)}` : ''
  const doFetch = opts.fetchImpl ?? ((...args) => fetch(...args))
  const res = await doFetch(`${base}/api/files${qs}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  if (!res.ok) throw new Error(`[cloud-save] 上传失败 ${res.status}`)
  return (await res.json()) as UploadedFile
}

/** 便捷：dataURL 直接上传 */
export async function uploadDataUrl(dataUrl: string, opts: UploadOptions = {}): Promise<UploadedFile> {
  return uploadBlob(dataUrlToBlob(dataUrl), opts)
}

/** 节点里可以搬走的字段（名字 → 值）。只认这几个"资源字段"，不碰 text 之类 */
export interface UploadableField {
  /** 节点 id */
  nodeId: string
  /** 字段名（如 imageUrl） */
  field: string
  /** 当前 dataURL */
  value: string
}

/**
 * 扫出所有"值得搬"的资源字段。
 * 只看**已知的资源字段名**（imageUrl/videoUrl/audioUrl/posterUrl），不扫全部 data 键 ——
 * 免得把用户在文本节点里输入的、恰好以 `data:image/` 开头的一大段字当成图片搬走。
 */
export const RESOURCE_FIELDS = ['imageUrl', 'videoUrl', 'audioUrl', 'posterUrl'] as const

export function collectUploadableFields(
  nodes: Array<{ id: string; data?: Record<string, unknown> }>,
  minBytes = DEFAULT_MIN_UPLOAD_BYTES,
): UploadableField[] {
  const out: UploadableField[] = []
  for (const n of nodes) {
    const data = n.data
    if (!data) continue
    for (const field of RESOURCE_FIELDS) {
      const v = data[field]
      if (isUploadableDataUrl(v, minBytes)) out.push({ nodeId: n.id, field, value: v })
    }
  }
  return out
}

/**
 * 把扫出来的字段逐个上传，返回"要写回节点的补丁"（nodeId → { 字段: 新 URL }）。
 * 单个失败不影响其它（返回结果里带上失败清单，调用方可据此只重试失败的）。
 */
export async function uploadFields(
  fields: UploadableField[],
  opts: UploadOptions = {},
): Promise<{ patches: Array<{ nodeId: string; data: Record<string, unknown> }>; errors: Array<{ nodeId: string; field: string; error: string }> }> {
  const patches: Array<{ nodeId: string; data: Record<string, unknown> }> = []
  const errors: Array<{ nodeId: string; field: string; error: string }> = []
  for (const f of fields) {
    try {
      const info = parseDataUrl(f.value)
      const uploaded = await uploadDataUrl(f.value, {
        ...opts,
        ...(info ? { name: `asset${extForMime(info.mime)}` } : {}),
      })
      // 同一个节点可能有多个资源字段：合并进同一个补丁
      const exist = patches.find((p) => p.nodeId === f.nodeId)
      if (exist) exist.data[f.field] = uploaded.url
      else patches.push({ nodeId: f.nodeId, data: { [f.field]: uploaded.url } })
    } catch (err) {
      errors.push({ nodeId: f.nodeId, field: f.field, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { patches, errors }
}
