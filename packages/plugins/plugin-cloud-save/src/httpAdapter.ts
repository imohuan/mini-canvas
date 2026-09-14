/**
 * HttpAdapter —— 把 SaveService 的某一类（canvas / resource）后端换成 cloud-server 的 HTTP 接口。
 *
 * 实现的是数据层既有的 `StorageAdapter` 契约（get/set/remove），所以换上去之后
 * **上层一行都不用改**：host 的 graph 提交、插件里的 save.set、恢复时的 save.get
 * 全部自动走网络。
 *
 * 一条必须守住的语义：**404 = 从未保存过 → 返回 undefined**。
 * 数据层靠 `undefined` 与"保存过空数组"区分（空画布刷新不该重新长出默认节点）。
 * 若这里把 404 变成 200+null，空画布就会被当成"存过 null"，恢复逻辑走错分支。
 */
import type { SaveType, StorageAdapter } from '@mini-canvas/canvas-data'

export interface HttpAdapterOptions {
  /** 服务根地址；空串 = 与画布同源（cloud-server 托管 ui 时的默认情况） */
  baseUrl?: string
  /** 本 adapter 负责的作用域（决定 URL 里的 :type 段） */
  type: SaveType
  /** 注入 fetch（测试用假实现；不传用全局 fetch） */
  fetchImpl?: typeof fetch
}

/** 拼 URL：baseUrl 末尾斜杠去掉，避免出现 `//api` */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

export class HttpAdapter implements StorageAdapter {
  readonly id = 'http'
  readonly capability = { list: true, transactional: false, offline: false }

  private readonly baseUrl: string
  private readonly type: SaveType
  private readonly fetchImpl: typeof fetch

  constructor(opts: HttpAdapterOptions) {
    this.baseUrl = opts.baseUrl ?? ''
    this.type = opts.type
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args))
  }

  /**
   * 物理 key（`canvas:graph`）→ 裸 key（`graph`）。
   * SaveService 交给 adapter 的 key 已经带了 type 前缀（scopedKey 的产物），
   * 而 URL 与磁盘布局里 type 是独立一段（/api/kv/canvas/graph → kv/canvas%3Agraph.json），
   * 所以这里要把前缀摘掉再拼 URL，否则会变成 canvas:canvas:graph 这种双重前缀。
   */
  bareKey(key: string): string {
    const prefix = `${this.type}:`
    return key.startsWith(prefix) ? key.slice(prefix.length) : key
  }

  /** 某个 key 对应的接口地址 */
  urlFor(key: string): string {
    return joinUrl(this.baseUrl, `/api/kv/${this.type}/${encodeURIComponent(this.bareKey(key))}`)
  }

  /**
   * 一次读回本作用域下的多个 key（没有的 key 不出现在返回里，等价于 `undefined`）。
   *
   * 为什么要批量口：恢复画布要同时读 graph / graph-edges / graph-viewport。
   * 逐个读时未保存的那些会各回一个 404 —— 语义没错（"从未保存过"就该是 404），
   * 但浏览器会在 console 里记几条"加载资源失败"，用户看着像坏了。批量口一次拿齐，
   * 少两次往返、也不刷那些 404。
   */
  async getMany(keys: string[]): Promise<Record<string, unknown>> {
    const url = joinUrl(this.baseUrl, `/api/kv/${this.type}/?values=1`)
    const res = await this.fetchImpl(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`[cloud-save] 批量读取失败 ${res.status}: ${url}`)
    const body = (await res.json()) as { values?: Record<string, unknown> }
    const all = body.values ?? {}
    // 只回调用方要的那些 key（作用域里可能还有别的）
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      if (k in all) out[k] = all[k]
    }
    return out
  }

  async get<T>(key: string): Promise<T | undefined> {
    const res = await this.fetchImpl(this.urlFor(key), { headers: { accept: 'application/json' } })
    // 404 是**正常路径**（从未保存过），不是错误
    if (res.status === 404) return undefined
    if (!res.ok) throw new Error(`[cloud-save] 读取失败 ${res.status}: ${this.urlFor(key)}`)
    const body = (await res.json()) as { value?: T }
    return body.value
  }

  async set(key: string, value: unknown): Promise<void> {
    const res = await this.fetchImpl(this.urlFor(key), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value }),
    })
    if (!res.ok) throw new Error(`[cloud-save] 写入失败 ${res.status}: ${this.urlFor(key)}`)
  }

  async remove(key: string): Promise<void> {
    const res = await this.fetchImpl(this.urlFor(key), { method: 'DELETE' })
    // 删不存在的也算成功（DELETE 幂等）；只把真正的服务端错误抛出去
    if (!res.ok && res.status !== 404) {
      throw new Error(`[cloud-save] 删除失败 ${res.status}: ${this.urlFor(key)}`)
    }
  }
}
