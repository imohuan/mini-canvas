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
