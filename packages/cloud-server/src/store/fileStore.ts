/**
 * fileStore —— 服务端文件资源落盘（纯逻辑，Node fs，可单测）。
 *
 * 磁盘布局：`{dir}/uploads/{sha256前16位}{ext}`。
 *
 * 按**内容哈希**命名的两个好处：
 * 1. 同内容重复上传天然去重（不占两份空间）；
 * 2. URL 与内容绑定 → 可安全下长缓存头（内容永不改，改内容即改 URL）。
 *
 * 保留原扩展名：浏览器按扩展名/MIME 判断如何展示（canvas 取图时尤其重要）。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

/** 一次上传的结果（回给客户端的形状） */
export interface StoredFile {
  /** 文件 id（= 磁盘上的文件名，如 `a1b2c3.png`） */
  id: string
  /** 同源相对路径（客户端写进 data.imageUrl；刷新后仍有效） */
  url: string
  /** 字节数 */
  size: number
  /** 推断出的 MIME（从扩展名） */
  mime: string
}

/** 常见扩展名 → MIME（上传时按扩展名给 Content-Type，不依赖客户端声明） */
const MIME_BY_EXT: Record<string, string> = {
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
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
};

/** 允许的扩展名（挡住 .html/.js 之类：同源托管下它们会造成 XSS 面） */
export const ALLOWED_EXT: readonly string[] = Object.keys(MIME_BY_EXT)

/** 从文件名/MIME 里取一个安全的扩展名（不认识就空串） */
export function safeExt(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase()
  return ALLOWED_EXT.includes(ext) ? ext : ''
}

/** 内容哈希 → 文件 id（前 16 位足够，冲突概率可忽略，且短 URL 好看） */
export function contentId(bytes: Uint8Array, ext: string): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16) + ext;
}

/** 由 id 推 MIME（未知扩展名回落 octet-stream） */
export function mimeOf(id: string): string {
  return MIME_BY_EXT[path.extname(id).toLowerCase()] ?? 'application/octet-stream'
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

/** 文件 id 是否合法（挡路径穿越：只允许 hex + 已知扩展名） */
export function isSafeFileId(id: string): boolean {
  return /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i.test(id);
}

/**
 * FileStore —— 一个根目录下的文件存储。
 *
 * `save` 返回的 `url` 是**同源相对路径**（`/uploads/xxx.png`）：
 * 客户端直接写进 `data.imageUrl`，刷新后仍能取到。
 */
export class FileStore {
  constructor(private readonly dir: string) {}

  private uploadsDir(): string {
    return path.join(this.dir, 'uploads')
  }

  /**
   * 存一个文件。已存在同内容则**不重复写**，直接返回既有条目（去重）。
   * @param ext 扩展名（含点，如 '.png'）；空串表示未知类型
   */
  async save(bytes: Uint8Array, ext = ''): Promise<StoredFile> {
    await fs.mkdir(this.uploadsDir(), { recursive: true })
    const id = contentId(bytes, ext)
    const file = path.join(this.uploadsDir(), id)
    const exists = await fileExists(file)
    if (!exists) {
      // 原子写：先临时再 rename，避免并发读到半截文件
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      await fs.writeFile(tmp, bytes)
      await fs.rename(tmp, file)
    }
    return { id, url: `/uploads/${id}`, size: bytes.byteLength, mime: mimeOf(id) }
  }

  /**
   * 读一个文件；不存在返回 undefined。
   * 返回 `Uint8Array<ArrayBuffer>`（而非 Node Buffer 的 ArrayBufferLike）：
   * Hono 的 c.body 只接受前者，直接交 Buffer 会在类型上不兼容。
   */
  async read(id: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!isSafeFileId(id)) return undefined
    try {
      const buf = await fs.readFile(path.join(this.uploadsDir(), id))
      return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
    } catch (err) {
      if (isNotFound(err)) return undefined
      throw err
    }
  }

  /** 列全部文件 id（后台查看用） */
  async ids(): Promise<string[]> {
    try {
      const names = await fs.readdir(this.uploadsDir())
      return names.filter((n) => isSafeFileId(n)).sort()
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
