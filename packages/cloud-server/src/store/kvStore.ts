/**
 * kvStore —— 服务端 key-value 落盘（纯逻辑，Node fs，可单测）。
 *
 * 磁盘布局（对齐计划 §二）：`{dir}/kv/{type}:{key}.json`，每项一个文件。
 *
 * 为什么一项一文件（而不是一个总 JSON）：
 * - SaveService 是按 key 增量 set 的，整包写会把不相关的域也一起重写；
 * - 一个文件坏掉不会连带其它数据；
 * - 与客户端 `save.get(key)` 一一对应，语义直白。
 *
 * key 安全：物理 key（如 `canvas:graph`）含 `:`，Windows 文件名不允许，
 * 故落盘时按 `encodeURIComponent` 转义（`canvas%3Agraph.json`），读回时反解。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

/** 允许的 value 作用域（与客户端 SaveType 一致） */
export type KvType = 'config' | 'canvas' | 'resource' | 'shortcut'

const KV_TYPES: readonly KvType[] = ['config', 'canvas', 'resource', 'shortcut']

/** 校验作用域是否合法（挡住把任意路径写进来的可能） */
export function isKvType(v: string): v is KvType {
  return (KV_TYPES as readonly string[]).includes(v)
}

/**
 * 物理文件名：`{type}:{key}` → 安全文件名。
 * 同时反解用的前缀校验，避免 `..` 之类越权路径。
 */
export function kvFileName(type: string, key: string): string {
  return encodeURIComponent(`${type}:${key}`) + '.json'
}

/**
 * kvStore —— 一个根目录下的 KV 存储。
 *
 * 语义：`get` 未命中返回 **undefined**（不是 null）—— 调用方（HttpAdapter）
 * 靠这个判"从未保存过"，与客户端 `saved === undefined` 对齐（否则空画布会重新长 seed）。
 */
export class KvStore {
  constructor(private readonly dir: string) {}

  /** kv 目录绝对路径（懒创建） */
  private kvDir(): string {
    return path.join(this.dir, 'kv')
  }

  /** 某项的文件路径 */
  private filePath(type: string, key: string): string {
    return path.join(this.kvDir(), kvFileName(type, key))
  }

  /** 读一项；不存在返回 undefined */
  async get<T = unknown>(type: string, key: string): Promise<T | undefined> {
    try {
      const raw = await fs.readFile(this.filePath(type, key), 'utf8')
      return JSON.parse(raw) as T
    } catch (err) {
      // 文件不存在 = 从未保存过（正常路径）；JSON 坏掉也当缺失，避免整个服务 500
      if (isNotFound(err)) return undefined
      return undefined
    }
  }

  /** 写一项（原子写：先写临时文件再 rename，避免半截 JSON） */
  async set(type: string, key: string, value: unknown): Promise<void> {
    // JSON.stringify(undefined) 返回 undefined（不是字符串），直接写会抛难懂的 TypeError。
    // 明确拒绝：想删用 remove（语义清晰，调用方不会「以为存了 undefined」）。
    if (value === undefined) {
      throw new Error(`[kvStore] 不接受 undefined 值（type=${type} key=${key}）：要删请用 remove`)
    }
    await fs.mkdir(this.kvDir(), { recursive: true })
    const file = this.filePath(type, key)
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmp, JSON.stringify(value), 'utf8')
    await fs.rename(tmp, file)
  }

  /** 删一项；返回是否真删到 */
  async remove(type: string, key: string): Promise<boolean> {
    try {
      await fs.unlink(this.filePath(type, key))
      return true
    } catch (err) {
      if (isNotFound(err)) return false
      throw err
    }
  }

  /** 列某作用域下全部裸 key（诊断/后台查看用） */
  async keys(type: string): Promise<string[]> {
    let names: string[]
    try {
      names = await fs.readdir(this.kvDir())
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
    const prefix = `${type}:`
    const out: string[] = []
    for (const n of names) {
      if (!n.endsWith('.json') || n.includes('.tmp-')) continue
      const decoded = decodeURIComponent(n.slice(0, -'.json'.length))
      if (decoded.startsWith(prefix)) out.push(decoded.slice(prefix.length))
    }
    return out.sort()
  }
}

/** 判断 fs 错误是不是"文件不存在" */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT'
}
