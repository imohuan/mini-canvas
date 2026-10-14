/**
 * CanvasResourceStore —— 本画布的资源读写（`<root>/canvases/<id>/resources/`）。
 *
 * 命名按**内容哈希**（sha256 前 16 位）+ 扩展名，与既有的 FileStore 同规矩：
 * 同内容天然去重、地址与内容绑定（内容一变地址就变，所以能挂长缓存）。
 *
 * **节点里存「同源 URL」**：`/api/canvases/<canvasId>/resources/<hashName>`（见 toResourceUrl）。
 * 浏览器直接能请求 —— 渲染 / 下单 / 资产登记都不必再"先解析引用再拼地址"。
 * 曾经用过的 `res:<hash>` 相对引用已彻底移除（连读取兼容也没有），存量已由
 * scripts/migrate-res-to-url.mjs 迁完。
 */
import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { canvasResourcesDir } from './canvasPaths.js'
import { ALLOWED_EXT } from './mime.js'

/**
 * 资源地址（新写入的唯一形态）：`/api/canvases/<canvasId>/resources/<hashName>`。
 *
 * 为什么不带 origin：云端可能换机器 / 换端口 / 挂反代，写死 origin 迟早失效；
 * 同源相对路径在任何部署形态下都对。hashName 是 16 位十六进制 + 可选扩展名（白名单形态），
 * 无需 URL 转义。
 */
export function toResourceUrl(canvasId: string, hashName: string): string {
  return '/api/canvases/' + canvasId + '/resources/' + hashName
}

/**
 * 从「画布资源地址」里取资源名。
 *
 * 节点里存的就是这个地址（或它的带 origin 版本），后台收到的参考图也是它。
 * 画布 id 必须与调用方给的一致（不认别的画布的资源，防串）。
 */
export function parseResourceNameFromUrl(url: string, canvasId: string): string | undefined {
  const markers = ['/api/canvases/' + canvasId + '/resources/', '/canvases/' + canvasId + '/resources/']
  for (const marker of markers) {
    const i = url.indexOf(marker)
    if (i < 0) continue
    const name = url.slice(i + marker.length).split('?')[0].split('#')[0]
    if (isSafeResourceName(name)) return name
  }
  return undefined
}

/** 资源名白名单（两种形态都合法）：
 *  ① 内容寻址：16 位十六进制 + 可选扩展名（上传/生成产物走这条，同内容天然去重）
 *  ② 覆盖槽位：slot-<槽位id> + 可选扩展名（见 saveSlot 的说明）
 *
 * 两条都是**单段、不含路径分隔符**，所以挡得住路径穿越；扩展名只收白名单字母数字。
 */
const HASH_NAME_RE = /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i
const SLOT_NAME_RE = /^slot-[A-Za-z0-9_-]{1,64}(\.[a-z0-9]+)?$/

export function isSafeResourceName(name: string): boolean {
  return HASH_NAME_RE.test(name) || SLOT_NAME_RE.test(name)
}

/** 槽位 id 白名单：字母数字下划线连字符，1-64 位 */
const SLOT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeSlotId(id: string): boolean {
  return SLOT_ID_RE.test(id)
}

/**
 * 这个资源名是不是**覆盖槽位**（而不是内容寻址）。
 *
 * 用途：两者的缓存策略相反 —— 内容寻址可以长缓存（地址与内容绑定），
 * 而槽位是**同一个地址内容会变**，必须禁缓存，否则浏览器一直给旧图。
 */
export function isSlotName(name: string): boolean {
  return name.startsWith('slot-')
}

export interface SavedResource {
  /** 写进节点 data 的地址（同源 URL：`/api/canvases/<画布id>/resources/<hashName>`） */
  url: string
  /** 磁盘上的文件名 */
  hashName: string
  /** 字节数 */
  size: number
}

export class CanvasResourceStore {
  constructor(private readonly root: string) {}

  /**
   * 存一个资源；同内容不重复写。返回**同源 URL**（写进节点 data 的那个）与磁盘名。
   *
   * 这里就返回 URL 而不是 `res:<hash>`：写入侧只有这一个出口，统一了才不会有人漏改。
   */
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
    return { url: toResourceUrl(canvasId, hashName), hashName, size: bytes.byteLength }
  }

  /**
   * **把字节覆盖到某个槽位**（同一个槽位永远同一份文件，内容直接被换掉）。
   *
   * ## 为什么要有它（与 save 的区别）
   *
   * `save` 是内容寻址：内容一变就是**新文件**，天然去重、地址可长缓存。
   * 但「可视化节点的输出」不行 —— 用户画一笔就要出一份新图，内容寻址会让磁盘上
   * 每笔多一个文件（画 100 笔 = 100 个文件，而这些历史版本一个都不需要）。
   *
   * 所以另开一条：**按槽位固定命名、原地覆盖**。一个节点一个槽位，永远只有最新一份。
   * 参数化扩展名，图片 / 视频 / 音频共用同一条路（slot-<节点id>.png / .mp4 / .mp3）。
   *
   * 代价（必须知道）：URL 不变而内容会变 —— 所以读取侧**不能长缓存**，
   * 见 routes/canvases.ts 里按 isSlotName 分流的 cache-control。
   */
  async saveSlot(canvasId: string, slotId: string, bytes: Uint8Array, ext = ''): Promise<SavedResource> {
    if (!isSafeSlotId(slotId)) throw new Error('非法槽位 id: ' + slotId)
    const dir = canvasResourcesDir(this.root, canvasId)
    const safeExt = ALLOWED_EXT.includes(ext.toLowerCase()) ? ext.toLowerCase() : ''
    // 换过扩展名（图片 → 视频）时把同槽位的旧扩展名文件清掉，免得两个文件同时存在、
    // 「读的时候取哪个」变得不确定
    const hashName = 'slot-' + slotId + safeExt
    await fs.mkdir(dir, { recursive: true })
    const otherExts = ALLOWED_EXT.filter((e) => e !== safeExt)
    for (const e of otherExts) {
      const stale = path.join(dir, 'slot-' + slotId + e)
      await fs.rm(stale, { force: true }).catch(() => undefined)
    }
    const file = path.join(dir, hashName)
    // 原地覆盖：同样先写临时文件再 rename（避免读到半截）
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
    await fs.writeFile(tmp, bytes)
    await fs.rename(tmp, file)
    return { url: toResourceUrl(canvasId, hashName), hashName, size: bytes.byteLength }
  }

  /** 读本画布某个资源；名字不合法或不存在 → undefined */
  async read(canvasId: string, hashName: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!isSafeResourceName(hashName)) return undefined
    return readBytes(path.join(canvasResourcesDir(this.root, canvasId), hashName))
  }

  /**
   * 只读文件头 n 字节（类型嗅探用，见 mime.sniffMimeFromHead）。
   *
   * 为什么不复用 read：资源里有不少几 MB 的图，只为了判个类型把整张读进内存纯属浪费
   * （列表接口一次要判几十个）。名字不合法 / 不存在 → undefined（与 read 同口径）。
   */
  async readHead(canvasId: string, hashName: string, n = 16): Promise<Uint8Array | undefined> {
    if (!isSafeResourceName(hashName)) return undefined
    let fh: FileHandle | undefined
    try {
      fh = await fs.open(path.join(canvasResourcesDir(this.root, canvasId), hashName), 'r')
      const buf = new Uint8Array(n)
      const { bytesRead } = await fh.read(buf, 0, n, 0)
      return buf.subarray(0, bytesRead)
    } catch (err) {
      if (isNotFound(err)) return undefined
      throw err
    } finally {
      await fh?.close()
    }
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
