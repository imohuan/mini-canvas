/**
 * CloudKvAdapter —— 把「文本形式」的某一格（config / shortcut）接到 cloud-server 的 KV 接口。
 *
 * 为什么需要它：云模式下只把画布与资源切到服务器、config/shortcut 留在浏览器 local，
 * 换台机器设置就全没了。用户要求「云端时配置与快捷键也用云端的」，于是这两格也换成它。
 *
 * 契约与本地 adapter 完全一致（get/set/remove），所以上层一行不用改 —— 换的只是物理落点。
 *
 * 一条必须守住的语义：**404 = 从未保存过 → 返回 undefined**。
 * 数据层靠 undefined 与「存过空值」区分（空配置刷新后不该被当成"存过"）。
 *
 * 零 import / 零 Vue：本插件要打成自包含单文件（见 vite.config.ts 的说明）。
 */
import { joinUrl, type FetchLike } from './apiTypes.js'

export interface CloudKvAdapterOptions {
  /** 服务根地址；空串 = 与画布同源 */
  baseUrl?: string
  /** 本 adapter 负责的作用域（config / shortcut） */
  type: string
  /** 注入 fetch（测试用假实现；不传用全局 fetch） */
  fetchImpl?: FetchLike
}

export interface CloudKvAdapter {
  readonly id: string
  readonly capability: { list: boolean; transactional: boolean; offline: boolean }
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/** 物理 key（`config:settings`）→ 裸 key（`settings`）：URL 里 type 是独立一段 */
export function bareKvKey(type: string, key: string): string {
  const prefix = type + ':'
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

export function createCloudKvAdapter(opts: CloudKvAdapterOptions): CloudKvAdapter {
  const baseUrl = opts.baseUrl ?? ''
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const urlFor = (key: string): string =>
    joinUrl(baseUrl, '/api/kv/' + opts.type + '/' + encodeURIComponent(bareKvKey(opts.type, key)))

  return {
    id: 'cloud-kv-' + opts.type,
    capability: { list: true, transactional: false, offline: false },

    async get<T>(key: string): Promise<T | undefined> {
      const res = await doFetch(urlFor(key), { headers: { accept: 'application/json' } })
      // 404 是**正常路径**（从未保存过），不是错误
      if (res.status === 404) return undefined
      if (!res.ok) throw new Error('[cloud-client] 读取 ' + opts.type + ' 失败 ' + res.status)
      const body = (await res.json()) as { value?: T }
      return body.value
    },

    async set(key: string, value: unknown): Promise<void> {
      const res = await doFetch(urlFor(key), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (!res.ok) throw new Error('[cloud-client] 写入 ' + opts.type + ' 失败 ' + res.status)
    },

    async remove(key: string): Promise<void> {
      const res = await doFetch(urlFor(key), { method: 'DELETE' })
      // 删不存在的也算成功（DELETE 幂等）
      if (!res.ok && res.status !== 404) {
        throw new Error('[cloud-client] 删除 ' + opts.type + ' 失败 ' + res.status)
      }
    },
  }
}

