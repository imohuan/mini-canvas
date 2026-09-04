import type { StorageAdapter } from './types'

/**
 * getLocalStorage —— 惰性取全局 localStorage（node 环境无则返回 null，
 * 以便 vitest 用 mock 或降级。浏览器里恒有）。
 */
function getStorage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? (globalThis as { localStorage: Storage }).localStorage
      : null
  } catch {
    return null
  }
}

/**
 * LocalStorageAdapter —— 浏览器 localStorage 后端（v2 默认本地落点）。
 *
 * 语义：setItem(`${key}`)，value JSON 序列化。key 已由 SaveService 带 type 前缀。
 * 与 MemoryStorageAdapter 同接口，可互换（本地/云端可插拔）。
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly id = 'localStorage'
  readonly capability = { list: true, transactional: false, offline: true }
  private storage: Storage | null

  constructor(storage?: Storage) {
    this.storage = storage ?? getStorage()
  }

  /** 是否真正可用（node 测试里没 localStorage 时为 false） */
  get available(): boolean {
    return this.storage !== null
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.storage) return undefined
    const raw = this.storage.getItem(key)
    if (raw === null) return undefined
    try {
      return JSON.parse(raw) as T
    } catch {
      return undefined
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    if (!this.storage) return
    this.storage.setItem(key, JSON.stringify(value))
  }

  async remove(key: string): Promise<void> {
    if (!this.storage) return
    this.storage.removeItem(key)
  }
}
