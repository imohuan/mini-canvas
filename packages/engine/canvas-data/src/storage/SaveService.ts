import type { AutoSaveService } from '../autoSave'
import type { SettingsPersistFacade } from '../settingsPersist'
import type { SaveService, SaveType, StorageAdapter, ResourceAdapter } from './types'
import { isResourceAdapter } from './types'
import { MemoryStorageAdapter } from './memoryAdapter'
import { scopedKey, SAVE_TYPES } from './keys'

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
  /** 配置持久化子对象（基础插件 apply 时条件挂上） */
  settings?: SettingsPersistFacade
  /** 自动保存子对象（auto-save 插件 apply 时挂上） */
  autoSave?: AutoSaveService

  /**
   * 每个 type 的激活 adapter。
   *
   * `'resource'` 那一格放的是 `ResourceAdapter`（字节流），其余三格是 `StorageAdapter`（key-value）——
   * 两者接口不同，故这里用联合类型。取用方按 `isResourceAdapter` 判形状（见 resourceService）。
   */
  private adapters = new Map<SaveType, StorageAdapter | ResourceAdapter>()
  /** 未落盘的脏 set：key(type:) → { value, type } */
  private dirty = new Map<string, { value: unknown; type: SaveType }>()
  private timer: ReturnType<typeof setTimeout> | null = null
  /** 正在跑的那次落盘（flush 串行化用） */
  private inflight: Promise<void> | null = null
  /** 适配器切换订阅者（见 onAdapterChange） */
  private adapterListeners = new Set<(type: SaveType) => void>()

  /** 默认每 type 用内存 adapter（可被 useAdapter 覆盖为 localStorage/backend） */
  constructor(defaultAdapter?: StorageAdapter) {
    const base = defaultAdapter ?? new MemoryStorageAdapter()
    for (const t of SAVE_TYPES) {
      this.adapters.set(t, base)
    }
  }

  set(key: string, value: unknown, type: SaveType = 'config'): void {
    const prefixed = scopedKey(type, key)
    this.dirty.set(prefixed, { value, type })
    this.scheduleFlush()
  }

  async get<T>(key: string, type: SaveType = 'config'): Promise<T | undefined> {
    const adapter = this.adapters.get(type)! as StorageAdapter
    return adapter.get<T>(scopedKey(type, key))
  }

  async remove(key: string, type: SaveType = 'config'): Promise<void> {
    const prefixed = scopedKey(type, key)
    this.dirty.delete(prefixed)
    await (this.adapters.get(type)! as StorageAdapter).remove(prefixed)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    // ★ 串行化：若已有一次落盘在跑，**先等它结束**。
    // 之前的写法是并发调用各写各的 —— 定时器那一轮把脏队列快照走了，守卫再调 flush 时队列已空、
    // 立刻返回，于是「await flush 完再导航」根本没等到真正的写。导航一发生，那次在飞的请求被打断，
    // 改动就丢了（用户实测：编辑后立刻切画布，回来发现没保存）。等它结束再处理新脏数据，才是真的写完了。
    if (this.inflight) {
      try {
        await this.inflight
      } catch {
        /* 上一轮的失败已把该项放回 dirty，下面会重试 */
      }
    }
    // 快照后清空，避免落盘期间新 set 被并发吞
    const batch = [...this.dirty.entries()]
    this.dirty.clear()
    if (batch.length === 0) return
    this.inflight = (async () => {
      for (const [prefixed, { value, type }] of batch) {
        try {
          await (this.adapters.get(type)! as StorageAdapter).set(prefixed, value)
        } catch (err) {
          // 存储配额不足不能变成未捕获 Promise；保留脏数据，下一次 flush 仍可重试。
          this.dirty.set(prefixed, { value, type })
          console.warn(`[save] 写入失败（${prefixed}），可能是浏览器存储配额不足`, err)
        }
      }
    })()
    try {
      await this.inflight
    } finally {
      this.inflight = null
    }
  }

  isDirty(): boolean {
    return this.dirty.size > 0
  }

  /** 切换某 type 的激活 adapter */
  useAdapter(type: SaveType, adapter: StorageAdapter | ResourceAdapter): void {
    this.adapters.set(type, adapter)
    // 通知订阅者（如配置持久化桥）：新后端可能已有数据，需要重读。
    // 在**切换之后**才通知 —— 订阅者回调里会去读，必须读得到新适配器。
    this.notifyAdapterChange(type)
  }

  /** 订阅「某 type 的激活 adapter 被切换」（见 types.ts 的说明） */
  onAdapterChange(cb: (type: SaveType) => void): { dispose(): void } {
    this.adapterListeners.add(cb)
    return { dispose: () => this.adapterListeners.delete(cb) }
  }

  /** 取某 type 当前的激活 adapter（资源库用它现取资源后端，见 types.ts 的说明） */
  adapterOf(type: SaveType): StorageAdapter | ResourceAdapter {
    return this.adapters.get(type)!
  }

  /** 所有 type 的 adapter 都切到同一后端（整包迁移场景） */
  useAdapterForAll(adapter: StorageAdapter | ResourceAdapter): void {
    // 资源适配器只属于 'resource' 那一格：它没有 get/set/remove，铺到别处会让文本读写全炸。
    if (isResourceAdapter(adapter)) {
      this.adapters.set('resource', adapter)
      return
    }
    for (const t of SAVE_TYPES) {
      this.adapters.set(t, adapter)
      this.notifyAdapterChange(t)
    }
  }

  /** 通知适配器切换订阅者；单个订阅者抛错不影响其它订阅者 */
  private notifyAdapterChange(type: SaveType): void {
    for (const cb of [...this.adapterListeners]) {
      try {
        cb(type)
      } catch {
        /* 订阅者自己的问题 */
      }
    }
  }

  /** 释放：清掉未触发的防抖计时器（不再需要自动 flush 时调用） */
  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
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
