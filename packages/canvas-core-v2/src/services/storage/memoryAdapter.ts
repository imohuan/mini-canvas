import type { StorageAdapter } from './types'

/**
 * MemoryStorageAdapter —— 纯内存后端（测试 / headless 跑全链用）。
 * 行为模拟 localStorage：set/get/remove，无持久化（进程内存活）。
 */
export class MemoryStorageAdapter implements StorageAdapter {
  readonly id = 'memory'
  readonly capability = { list: true, transactional: true, offline: true }
  private store = new Map<string, string>()

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.store.get(key)
    if (raw === undefined) return undefined
    return JSON.parse(raw) as T
  }

  async set(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value))
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key)
  }

  /** 测试辅助：清空 */
  clear(): void {
    this.store.clear()
  }
}
