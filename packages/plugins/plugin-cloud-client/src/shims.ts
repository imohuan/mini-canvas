// 类型垫片 —— 让插件在"零 import"的前提下还能有类型提示。
//
// 本插件不能 import 工作区包（产物必须自包含），但这些类型在编译期会被擦除、运行时不留痕迹。
// 所以这里只声明我们真正用到的那几个形状，由使用处按结构匹配（宿主传进来的 ctx 天然满足）。

/** 一次可回收的副作用句柄 */
export interface Disposable {
  dispose(): void
}

/** 插件作用域的最小面（本插件只用得到这几个） */
export interface PluginContext {
  get<T = unknown>(name: string): T
  tryGet<T = unknown>(name: string): T | undefined
  inject(name: string, impl: unknown): unknown
  registryOf<T>(kind: string): {
    remove(key: string, id: string): boolean
    list(key: string): Array<{ id: string; value: T }>
    keys(): string[]
  }
  on(name: string, handler: (...args: unknown[]) => void): Disposable
  effect(fn: () => (() => void) | void): Disposable
}

export type Context = PluginContext

/** 插件模块出口（与仓库其它插件同款） */
export interface PluginModule {
  name: string
  inject?: string[]
  Config?: unknown
  apply(ctx: Context): void
}

// —— StorageAdapter 的资源形式孔位（与 @mini-canvas/canvas-data 的 storage/types.ts 同形） ——
// 本插件不能 import 工作区包，故就地声明（产物必须自包含）。

export interface StorageAdapterCapability {
  list?: boolean
  transactional?: boolean
  offline?: boolean
}

export interface ResourcePutOptions {
  kind?: string
  name?: string
  /** 指定的持久引用名（名字可推算时用；见 canvas-data/shims 同名类型的说明） */
  ref?: string
  /** 派生资源（缩略图/帧图）：不写进节点 resourceId，故不参与"未被引用即回收" */
  derived?: boolean
}

export interface StorageAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

// 资源适配器：与文本适配器分开（两者操作不同 —— 见 canvas-data 的 storage/types.ts）
export interface ResourceAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability
  putResource(blob: Blob, opts: ResourcePutOptions): Promise<string>
  resolveResource(ref: string): Promise<string | undefined>
  removeResource(ref: string): Promise<void>
}
