/**
 * Save 层类型 —— 统一 key-value 持久化（API 契约定稿 §三 save）。
 *
 * type 四类(config/canvas/resource/shortcut)，key 统一小写 kebab、带作用域前缀。
 * 业务方只看到 key/value/type，物理落点由可插拔 StorageAdapter 决定（本地/云端各管一套）。
 */

export type SaveType = 'config' | 'canvas' | 'resource' | 'shortcut'

/** 存储后端能力声明（云端/本地差异暴露给上层可感知） */
export interface StorageAdapterCapability {
  /** 是否支持列出全部 key */
  list?: boolean
  /** 是否支持原子/事务写 */
  transactional?: boolean
  /** 是否可离线 */
  offline?: boolean
}

/**
 * StorageAdapter —— 一类 key 的物理落点。每个 adapter 只管自己的实现。
 * 同一 type 任一时刻只有一个激活 adapter（换云端 = 整包迁移，不做双写）。
 */
export interface StorageAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

/** ctx.get('save') 得到的 SaveService 形状 */
export interface SaveService {
  /** 入队写（同步返回，实际落盘经防抖 flush），type 默认 'config' */
  set(key: string, value: unknown, type?: SaveType): void
  /** 读 */
  get<T>(key: string, type?: SaveType): Promise<T | undefined>
  /** 删 */
  remove(key: string, type?: SaveType): Promise<void>
  /** 立即把脏队列落盘（可挂 hidden/pagehide/切项目/手动） */
  flush(): Promise<void>
  /** 是否有未落盘的脏 key */
  isDirty(): boolean
  /** 切换某 type 的激活 adapter（如 config 从本地切云端） */
  useAdapter(type: SaveType, adapter: StorageAdapter): void
}
