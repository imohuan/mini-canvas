import type { SaveService, SaveType, StorageAdapter } from './types'
import { MemoryStorageAdapter } from './memoryAdapter'

/**
 * SaveServiceImpl —— 统一 key-value 持久化的具体实现（作为 ctx 服务注入）。
 *
 * 设计要点（对齐 API 契约 §三）：
 * 1. 每 type 一个激活 adapter（默认 Memory，可 useAdapter 换 localStorage/backend）。
 * 2. set 先入脏队列（同步返回），实际落盘经防抖 flush —— 不在 set 里立即写。
 * 3. key 实际存时带 type 前缀，保证四类互不干扰。
 * 4. 绝不"卸载才存/手动才存"：业务只负责 set，落盘时机由 flush 统一(空闲/hidden/pagehide/切项目)。
 */
export class SaveServiceImpl implements SaveService {
  /** 每个 type 的激活 adapter */
  private adapters = new Map<SaveType, StorageAdapter>()
  /** 未落盘的脏 set：key(type:) → { value, type } */
  private dirty = new Map<string, { value: unknown; type: SaveType }>()
  private timer: ReturnType<typeof setTimeout> | null = null

  /** 默认每 type 用内存 adapter（可被 useAdapter 覆盖为 localStorage/backend） */
  constructor(defaultAdapter?: StorageAdapter) {
    const base = defaultAdapter ?? new MemoryStorageAdapter()
    for (const t of ['config', 'canvas', 'resource', 'shortcut'] as SaveType[]) {
      this.adapters.set(t, base)
    }
  }

  set(key: string, value: unknown, type: SaveType = 'config'): void {
    const prefixed = this.prefix(type, key)
    this.dirty.set(prefixed, { value, type })
    this.scheduleFlush()
  }

  async get<T>(key: string, type: SaveType = 'config'): Promise<T | undefined> {
    const adapter = this.adapters.get(type)!
    return adapter.get<T>(this.prefix(type, key))
  }

  async remove(key: string, type: SaveType = 'config'): Promise<void> {
    const prefixed = this.prefix(type, key)
    this.dirty.delete(prefixed)
    await this.adapters.get(type)!.remove(prefixed)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // 快照后清空，避免落盘期间新 set 被并发吞
    const batch = [...this.dirty.entries()]
    this.dirty.clear()
    for (const [prefixed, { value, type }] of batch) {
      await this.adapters.get(type)!.set(prefixed, value)
    }
  }

  isDirty(): boolean {
    return this.dirty.size > 0
  }

  useAdapter(type: SaveType, adapter: StorageAdapter): void {
    this.adapters.set(type, adapter)
  }

  /** 所有 type 的 adapter 都切到同一后端（整包迁移场景） */
  useAdapterForAll(adapter: StorageAdapter): void {
    for (const t of this.adapters.keys()) this.adapters.set(t, adapter)
  }

  private prefix(type: SaveType, key: string): string {
    return `${type}:${key}`
  }

  private scheduleFlush(): void {
    if (this.timer) return
    // 微任务级防抖：同一事件循环多次 set 合并一次 flush
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, 0)
  }
}
