/**
 * MIME 与扩展名的互查（纯查表，零依赖）。
 *
 * 为什么单独一层：上传（按 MIME 猜扩展名）与回读（按扩展名给 Content-Type）都要这张表，
 * 两边各写一份迟早会飘。白名单制 —— 表里没有的一律**不认**，
 * 因为同源托管下放行 `.html`/`.js` 等于开了一个 XSS 面。
 */
import path from 'node:path'

/** 已知扩展名 → MIME */
export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  // 文本类：任务脚本用 ctx.save("内容", "note.txt") 交产物时要走白名单，
  // 否则扩展名被抹掉、落成没有后缀的文件（2026-10-13 实测）。
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  // 节点包（可视化节点 + 它依赖的后台脚本打包成一个文件，可拖回画布）。
  // 为什么必须是"已知扩展名"：资产库的 saveUpload 会拿 safeExt 判安全后缀 ——
  // 白名单外的一律落成空扩展名，那样左侧抽屉就看不出它是"能拖出节点的东西"，
  // 只能当成一个普通文件（2026-10-13 加节点包时一并补上）。
  '.mcnode': 'application/x-mini-canvas-node',
}

/** 允许的扩展名（上传时按它过滤，白名单外的回落空串） */
export const ALLOWED_EXT: readonly string[] = Object.keys(MIME_BY_EXT)

/** 从文件名里取一个安全的扩展名（不认识就空串，不猜） */
export function safeExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  return ALLOWED_EXT.includes(ext) ? ext : ''
}

/** 由文件名推 MIME（未知扩展名回落 octet-stream） */
export function mimeFromName(name: string): string {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/** 由资源 id / 文件名推 MIME（与 mimeFromName 同一实现，保留旧名字给既有调用方） */
export function mimeOf(id: string): string {
  return mimeFromName(id)
}

/**
 * 头部字节嗅探：没有扩展名也能认出媒体类型。
 *
 * 为什么需要它：画布资源按**内容哈希**落盘、很多没有扩展名（既有 PNG 也有 OggS 音频），
 * 只按名字给类型会全落 octet-stream —— 前端把音频当图渲染就是裂图（用户报过）。
 * 反过来，格式也**不能靠猜**：猜错类型会喂出「能加载但坏掉」的图，所以只认下面这几组确定的魔数，
 * 认不出返回 undefined（宁可不认，也不错认）。
 */
export function sniffMimeFromHead(head: Uint8Array): string | undefined {
  const byteAt = (at: number): number => head[at] ?? -1
  /** head 第 at 字节起是否就是这段 ASCII（越界一律 false） */
  const asciiAt = (at: number, s: string): boolean => {
    if (at + s.length > head.length) return false
    for (let i = 0; i < s.length; i++) if (head[at + i] !== s.charCodeAt(i)) return false
    return true
  }
  /** ISO-BMFF：4 字节盒长 + 'ftyp' + 4 字节品牌；'ftyp' 起于 from 时给出品牌（小写） */
  const ftypBrand = (from: number): string | undefined =>
    asciiAt(from, 'ftyp') ? String.fromCharCode(...head.slice(from + 4, from + 8)).toLowerCase() : undefined

  if (byteAt(0) === 0x89 && asciiAt(1, 'PNG')) return 'image/png'
  if (byteAt(0) === 0xff && byteAt(1) === 0xd8 && byteAt(2) === 0xff) return 'image/jpeg'
  if (asciiAt(0, 'GIF8')) return 'image/gif'
  if (asciiAt(0, 'BM')) return 'image/bmp'
  if (asciiAt(0, 'RIFF') && asciiAt(8, 'WEBP')) return 'image/webp'
  if (asciiAt(0, 'RIFF') && asciiAt(8, 'WAVE')) return 'audio/wav'
  // ISO-BMFF（mp4 / avif）：ftyp 盒通常在文件开头，也可能被别的盒顶到第 4 字节
  const brands = [ftypBrand(0), ftypBrand(4)].filter((b): b is string => b !== undefined)
  if (brands.includes('avif')) return 'image/avif'
  if (brands.length > 0) return 'video/mp4'
  if (asciiAt(0, 'OggS')) return 'audio/ogg'
  if (asciiAt(0, 'ID3')) return 'audio/mpeg'
  // 裸 MP3 帧同步头（FF Ex）；必须排在 JPEG（FF D8 FF）之后，否则两者会撞
  if (byteAt(0) === 0xff && (byteAt(1) & 0xe0) === 0xe0) return 'audio/mpeg'
  return undefined
}

/** MIME 大类：前端据此决定「能不能塞进 <img>」（image / video / audio / other） */
export function kindOfMime(mime: string): 'image' | 'video' | 'audio' | 'other' {
  const m = mime.split(';')[0].trim().toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'other'
}

/**
 * 反过来：MIME → 扩展名（上传时没有文件名可用，只能看 Content-Type）。
 * 只认白名单里的类型；不认识的返回空串（不猜）。
 */
export function extFromMime(mime: string): string {
  const m = mime.split(';')[0].trim().toLowerCase()
  for (const [ext, mapped] of Object.entries(MIME_BY_EXT)) {
    if (mapped === m) return ext
  }
  return ''
}
