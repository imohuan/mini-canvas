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

/**
 * ResourceAdapter —— 资源（二进制：图片 / 视频 / 音频）的物理落点。
 *
 * **为什么与 StorageAdapter 分开**：两者操作根本不同 —— 文本是 key-value（读写 JSON），
 * 资源是字节流（存字节、按引用换地址）。硬塞进一个 interface 会让双方都写废码
 * （资源适配器被迫实现 get/set/remove 再抛错）。拆开后各自只有自己那几个方法。
 *
 * 唯一用它的地方是 `save` 的 `'resource'` 那一格（见 SaveService 的 adapters 表）。
 */
export interface ResourceAdapter {
  readonly id: string
  readonly capability: StorageAdapterCapability
  /**
   * 存一段二进制，返回**持久引用**（写进节点 data 的 `resourceId`）。
   *
   * 回**持久引用**：云端是同源 URL（`/api/canvases/<画布id>/resources/<哈希>`），
   * 本地是 `res-<n>` id；`resolveResource` 负责把它换成当前可显示地址。
   */
  putResource(blob: Blob, opts: ResourcePutOptions): Promise<string>
  /**
   * 用持久引用换一个**当前可用的显示地址**。
   *
   * - 本地：按 id 取回字节 → 建一个**临时** objectURL（刷新后由下一次 resolve 重建）；
   * - 云端：把引用拼成服务器地址（稳定，不必下载字节）。
   *
   * 取不到（资源不在）返回 undefined。
   */
  resolveResource(ref: string): Promise<string | undefined>
  /** 删掉一个资源（按持久引用） */
  removeResource(ref: string): Promise<void>
}

/** 判断一个 adapter 是不是资源适配器（有 putResource 即是） */
export function isResourceAdapter(a: unknown): a is ResourceAdapter {
  return !!a && typeof (a as ResourceAdapter).putResource === 'function'
}

/** putResource 的可选参数 */
export interface ResourcePutOptions {
  /** 资源种类（'image' | 'video' | 'audio' | 'text' | 自定义；供落盘扩展名/分类用） */
  kind?: string
  /** 原始文件名（供后端推断扩展名；真正的落盘名由后端决定） */
  name?: string
  /**
   * **指定的持久引用名**（不给则由后端自己起名）。
   *
   * 用于"名字可以推算"的资源：调用方按自己的规则算出名字，就能先问一句
   * "这个名字存在吗"（`resolve(ref)`），存在就复用、不存在才生成 ——
   * 于是同一种资源不会在每次打开画布时被重新造一遍。
   *
   * 后端应当**尽量**用它（本地当作存储键、云端落成固定名文件）；
   * 觉得不合适（超长 / 非法字符）可以退回自命名 —— 此时 resolve 拿不到，
   * 调用方按"没命中"处理，行为正确只是会多生成一次。
   */
  ref?: string
  /**
   * 这个资源是**派生资源**（由别的资源加工而来，如缩略图 / 视频帧图）。
   *
   * 语义只有一条、但很关键：**它不写进任何节点的 `resourceId`，因此不该被
   * "谁没引用就回收谁"的那种清理干掉**。详见 ResourceStore.disposeUnreferenced。
   */
  derived?: boolean
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
  useAdapter(type: SaveType, adapter: StorageAdapter | ResourceAdapter): void
  /**
   * 订阅「某 type 的激活 adapter 被切换」。返回取消句柄。
   *
   * 为什么要它：适配器是**运行期可换**的（云插件启动时把 config/shortcut/canvas 三格切到云端）。
   * 谁在启动阶段已经读过旧后端（如配置持久化桥先按本地恢复了设置），就得在换后端后**重读一次**，
   * 否则新后端里存着的值永远读不进来 —— 表现为「改了设置、settings.json 也在变，刷新却回到旧值」。
   */
  onAdapterChange(cb: (type: SaveType) => void): { dispose(): void }
  /**
   * 取某 type 当前的激活 adapter（只读）。
   *
   * 为什么要暴露：资源库（ResourceStore）不再自己攥着一个写死的后端，
   * 而是**用的时候向 save 要** —— 于是 `useAdapter('resource', 云端适配器)` 一换，
   * 资源就跟画布走同一个开关（与最初的设计一致：一个 adapter 管文本 + 资源两种形式）。
   */
  adapterOf(type: SaveType): StorageAdapter | ResourceAdapter
}
