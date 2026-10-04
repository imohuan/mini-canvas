/**
 * CanvasResourceStore —— 本画布的资源读写（`<root>/canvases/<id>/resources/`）。
 *
 * 命名按**内容哈希**（sha256 前 16 位）+ 扩展名，与既有的 FileStore 同规矩：
 * 同内容天然去重、地址与内容绑定（内容一变地址就变，所以能挂长缓存）。
 *
 * **引用形态 `res:<hashName>`**：节点里存的是画布内相对引用 —— 不带画布 id、不带根路径。
 * 这样整个画布文件夹复制到别处（或交给别人、进版本库）资源地址依然成立。
 * 绝对地址做不到这一点：复制成新画布后路径里还写着原画布 id，不是显示错东西就是 404。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canvasResourcesDir } from './canvasPaths.js'
import { ALLOWED_EXT } from './mime.js'

/** 画布内资源引用的前缀 */
export const RESOURCE_REF_PREFIX = 'res:'

export function toResourceRef(hashName: string): string {
  return RESOURCE_REF_PREFIX + hashName
}

export function isResourceRef(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(RESOURCE_REF_PREFIX)
}

/** `res:<hash>` → `<hash>`；不是引用或名字不合法 → undefined */
export function parseResourceRef(ref: string): string | undefined {
  if (!isResourceRef(ref)) return undefined
  const name = ref.slice(RESOURCE_REF_PREFIX.length)
  return isSafeResourceName(name) ? name : undefined
}

/** 资源名白名单：16 位十六进制 + 可选扩展名（与既有 isSafeFileId 同口径） */
const RESOURCE_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i

export function isSafeResourceName(name: string): boolean {
  return RESOURCE_NAME_RE.test(name)
}

export interface SavedResource {
  /** 写进节点 data 的引用（`res:<hash>`） */
  ref: string
  /** 磁盘上的文件名 */
  hashName: string
  /** 字节数 */
  size: number
}

export class CanvasResourceStore {
  constructor(private readonly root: string) {}

  /** 存一个资源；同内容不重复写。返回画布内引用与磁盘名 */
  async save(canvasId: string, bytes: Uint8Array, ext = ''): Promise<SavedResource> {
    const dir = canvasResourcesDir(this.root, canvasId)
    // 只认白名单里的媒体扩展名，其余（含 .html/.js/.mjs）一律不落扩展名 ——
    // 同源托管下放行它们等于开了 XSS 面（老 FileStore 就是这条规矩）。
    const safeExt = ALLOWED_EXT.includes(ext.toLowerCase()) ? ext.toLowerCase() : ''
    const hashName = createHash('sha256').update(bytes).digest('hex').slice(0, 16) + safeExt
    await fs.mkdir(dir, { recursive: true })
    const file = path.join(dir, hashName)
    if (!(await exists(file))) {
      const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
      await fs.writeFile(tmp, bytes)
      await fs.rename(tmp, file)
    }
    return { ref: toResourceRef(hashName), hashName, size: bytes.byteLength }
  }

  /** 读本画布某个资源；名字不合法或不存在 → undefined */
  async read(canvasId: string, hashName: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!isSafeResourceName(hashName)) return undefined
    return readBytes(path.join(canvasResourcesDir(this.root, canvasId), hashName))
  }

  /** 列本画布的资源名 */
  async list(canvasId: string): Promise<string[]> {
    try {
      const names = await fs.readdir(canvasResourcesDir(this.root, canvasId))
      return names.filter(isSafeResourceName).sort()
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/**
 * 读字节。返回 `Uint8Array<ArrayBuffer>`（而不是 Node Buffer 的 ArrayBufferLike）：
 * Hono 的 `c.body` 只接受前者，直接交 Buffer 在类型上不兼容。
 */
async function readBytes(file: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const buf = await fs.readFile(file)
    // 转成 Uint8Array<ArrayBuffer>：Hono 的 c.body 只接受这种，直接交 Buffer 类型不兼容
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)
  } catch (err) {
    if (isNotFound(err)) return undefined
    throw err
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
