/**
 * resourceService —— 资源生命周期管理（画布内 Blob/object URL 的登记与回收）。
 *
 * 解决的问题（全量审查 P1-14）：plugin-file-drop 把 URL.createObjectURL(file) 直接写进节点 data.imageUrl，
 * 而 object URL 只在当前文档生命周期有效——刷新图片失效；删除节点/关闭宿主也没有统一 revoke，
 * 会造成内存泄漏与"已删资源仍被引用"。
 *
 * 本服务的职责：
 * - 登记一个资源（Blob/File → 由注入的 urlFactory 生成 URL，或调用方直接给现成 url）→ 返回稳定资源 id；
 * - 以 id 查 URL / 查资源句柄；按 id 显式 revoke（也可登记一次性自动回收回调）；
 * - dispose() 全量回收（宿主 stop / 画布卸载时调用，配合节点级联删除）。
 *
 * 零 DOM：URL 的创建/回收（createObjectURL/revokeObjectURL）经注入的 ResourceUrlBackend 做，
 * 纯逻辑层只维护登记表与生命周期；测试注入假 backend 即可在 Node 环境验证。
 */

import type { ResourcePutOptions, ResourceAdapter } from './storage/types'

/** URL 生成/回收后端（浏览器实现包一层 URL.createObjectURL / revokeObjectURL；测试用假实现） */
export interface ResourceUrlBackend {
  /** 为资源生成一个 URL（缺省实现直通调用方给的 url 时可不实现） */
  createUrl?(resource: unknown): string
  /** 回收一个此前生成的 URL（必须实现；dispose/revoke 时调用） */
  revokeUrl(url: string): void
}

/**
 * 资源后端就是 `ResourceAdapter`（见 storage/types.ts）：存字节、按引用换地址。
 * 本服务**不自己持有它**，而是现取（`save.adapterOf('resource')`）——
 * 于是换 adapter 立刻生效，无需重建资源库。
 */
/** 登记的资源条目（只读视图） */
export interface ResourceEntry<T = unknown> {
  /** 资源 id（调用方写进节点 data 的引用键） */
  id: string
  /** 资源种类（'image' | 'text' | 自定义；供释放/诊断分类） */
  kind: string
  /** 生成的 URL（供渲染层直接消费；object URL 生命周期由本服务管） */
  url: string
  /** 原始资源句柄（Blob/File/string…；可选） */
  resource?: T
  /**
   * 派生资源（缩略图 / 帧图这类"由别的资源加工而来"的）。
   *
   * 语义只有一条：**它不会写进任何节点的 `resourceId`**，所以"未被引用就回收"
   * 的清理必须跳过它（否则刚生成就被清掉，下次打开又要重算一遍）。
   */
  derived?: boolean
}

/** 登记请求 */
export interface RegisterResourceInput<T = unknown> {
  kind?: string
  /** 原样保存的资源句柄 */
  resource?: T
  /** 显式给 URL（绕过 urlFactory；适合调用方已生成 URL 的场景） */
  url?: string
}

/** 资源服务接口（ctx.get('resources')） */
export interface ResourceService {
  /** 等待资源字节写入持久化存储。 */
  flush?(id: string): Promise<void>
  /**
   * 登记一个资源。优先用传入 url；否则用 backend.createUrl(resource) 生成（backend 未实现且无 url → 抛错）。
   * @returns 资源 id（格式 res-{n}，可写进节点 data 作引用）
   */
  register(input: RegisterResourceInput): string
  /**
   * 存一份资源字节，返回**持久引用**（写进节点 data 的 `resourceId`）。
   *
   * 这是上传/生成的统一入口：本地会进 IndexedDB，云端会传到画布文件夹 —— 由当前
   * `resource` 类型的 adapter 决定。回的是**持久引用**：云端是同源 URL
   * （`/api/canvases/<画布id>/resources/<哈希>`），本地是 `res-<n>` id；
   * 要用时由 resolve 换成当前可显示地址。
   */
  put(blob: Blob, opts?: ResourcePutOptions): Promise<string>
  /**
   * 用持久引用换一个当前可用的显示地址。
   *
   * 本地：按 id 取回字节 → 新建临时 objectURL；云端：拼服务器地址。取不到返回 undefined。
   */
  resolve(ref: string): Promise<string | undefined>
  /** 按 id 取条目；不存在 undefined */
  get(id: string): ResourceEntry | undefined
  /** 按 id 取 URL（渲染层读；不存在 undefined） */
  url(id: string): string | undefined
  /** 该资源是否仍存活（未 revoke/dispose） */
  alive(id: string): boolean
  /** 当前全部资源 id（诊断/宿主 stop 前遍历） */
  ids(): string[]
  /** 注销一个资源并回收其 URL。返回是否真回收。 */
  revoke(id: string): boolean
  /** 注销"资源句柄等于给定值"的全部条目（删节点级联：节点 data 持有同一 Blob 引用时用） */
  revokeByResource(resource: unknown): number
  /** 按 kind 前缀批量回收（如删 image 节点时 kind='image'） */
  revokeByKind(kind: string): number
  /**
   * 回收"未被给定存活资源 id 集合引用"的全部条目（图删除节点后 flush 时调用：
   * 宿主收集存活节点 data.resourceId → 本方法把已删节点的资源释放）。返回回收数。
   */
  disposeUnreferenced(referenced: ReadonlySet<string>): number
  /** 全量回收（宿主 stop/画布销毁） */
  dispose(): void
  /** 刷新后按资源 id 重建 object URL。 */
  restore?(id: string, kind?: string): Promise<string | undefined>
}

const RESOURCE_URL_FIELDS = [
  "imageUrl", "videoUrl", "audioUrl", "posterUrl", "thumbUrl", "maskUrl",
  "panoUrl", "leftImageUrl", "rightImageUrl",
] as const
/**
 * 保存画布前移除**当前页面之外取不回来**的临时地址。
 *
 * 只删两种（它们都有第二份拷贝兜底，刷新能重建）：
 * 1. `blob:` —— object URL 只在当前文档有效，真正的 Blob 已按 resourceId 存进持久化资源表；
 * 2. 带 `resourceId` 的 `data:` —— 同一份字节已在持久化资源表里，节点里这份是冗余副本。
 *
 * 刻意**不**删「内嵌的大 dataURL」：图片上传/裁剪/旋转/扩展产出的就是这种 dataURL，
 * 它是这张图**唯一**的一份（没有 resourceId、资源表里也没有）。删掉就等于刷新后图片消失
 * —— 而上传链路的设计前提正是「dataURL 写进节点 data，刷新照常显示」（见
 * plugin-node-image 的 imageTransform）。要瘦身请走「登记资源 → 写 resourceId」那条路，
 * 让字节进持久化资源表，而不是在保存时把数据销毁。
 */
export function sanitizeTransientResourceUrls<T extends { data?: Record<string, unknown> }>(nodes: T[]): T[] {
  return nodes.map((node) => {
    const data = node.data
    if (!data) return node
    const next = { ...data }
    for (const key of RESOURCE_URL_FIELDS) {
      if (typeof next[key] === "string") {
        const value = next[key] as string
        if (/^blob:/i.test(value) || (typeof next.resourceId === "string" && /^data:/i.test(value))) delete next[key]
      }
    }
    return { ...node, data: next }
  })
}

/** 各类节点的媒体 URL 字段（恢复资源时该写回哪个键）。判据与节点自身一致：node.type 优先。 */
const MEDIA_URL_FIELDS_BY_TYPE: Record<string, readonly string[]> = {
  video: ["videoUrl"],
  image: ["imageUrl"],
  panorama: ["panoUrl"],
  "3d-preview": ["imageUrl"],
  "image-compare": ["leftImageUrl", "rightImageUrl"],
}

/**
 * 某节点恢复资源时该写回的字段。
 *
 * 为什么不能只看 data 里现有的键：保存会清掉失效的临时地址，字段可能已经不在 data 里，
 * 只按"现有键"恢复等于什么都没恢复（视频就是这样变成"无视频"的）。
 * 因此先按节点类型给出该类型的媒体字段，类型未知时才退回扫描 data。
 */
export function mediaUrlFieldsOf(node: { type?: string; data?: Record<string, unknown> }): string[] {
  const fromData = typeof node.data?.nodeType === "string" ? (node.data.nodeType as string) : ""
  const declared = MEDIA_URL_FIELDS_BY_TYPE[node.type || fromData]
  if (declared) return [...declared]
  return RESOURCE_URL_FIELDS.filter((key) => typeof node.data?.[key] === "string")
}

/** 需要重建的媒体字段：缺失，或仍是只在当前页面有效的 blob:/data: 地址。 */
export function pendingMediaRestoreFields(node: { type?: string; data?: Record<string, unknown> }): string[] {
  return mediaUrlFieldsOf(node).filter((key) => {
    const value = node.data?.[key]
    return value === undefined || (typeof value === "string" && /^(blob:|data:)/i.test(value))
  })
}

/**
 * 刷新恢复：按节点 data.resourceId 重建各媒体字段的可用地址。
 *
 * @param restore 由宿主注入（assets/resources 后端）；返回 undefined 表示资源确实不在了。
 * @returns 实际重建的节点数
 */
export async function restoreNodeMediaUrls<T extends { type?: string; data?: Record<string, unknown> }>(
  nodes: T[],
  restore: (resourceId: string, kind: string) => Promise<string | undefined>,
): Promise<number> {
  let restored = 0
  for (const node of nodes) {
    const data = node.data
    const resourceId = typeof data?.resourceId === "string" ? data.resourceId : undefined
    if (!resourceId || !data) continue
    const fields = pendingMediaRestoreFields(node)
    if (fields.length === 0) continue
    const kind = node.type === "video" ? "video" : "image"
    const url = await restore(resourceId, kind)
    for (const key of fields) {
      // 只存 ID 的目标形态：解析结果不写回 data。
      // 但旧存档 / 旧组件仍可能读 xxxUrl（迁移期），这里只在字段**缺失或仍是失效 blob:/data:** 时
      // 补一份会话内副本；已有的持久地址不动，解析失败时只清掉失效地址，不新增空字段。
      if (!url) {
        const current = data[key]
        if (typeof current === "string" && /^(blob:|data:)/i.test(current)) delete data[key]
        continue
      }
      const current = data[key]
      if (current === undefined || (typeof current === "string" && /^(blob:|data:)/i.test(current))) {
        data[key] = url
      }
    }
    if (url) restored += 1
  }
  return restored
}

/** no-op URL 后端（backend 未给时的占位：register 显式给 url 可用，revoke no-op） */
const noopBackend: ResourceUrlBackend = {
  revokeUrl(): void { /* no-op */ },
}

/** 默认生成 id 的前缀 */
const ID_PREFIX = 'res-'

export class ResourceStore implements ResourceService {
  private entries = new Map<string, ResourceEntry>()
  private backend: ResourceUrlBackend
  private pending = new Map<string, Promise<void>>()
  private seq = 0

  /** 资源后端解析器（每次现取；构造未给 = 没有资源后端） */
  private readonly backendResolver: () => ResourceAdapter | undefined = () => undefined

  /**
   * 资源后端**现取**（不再构造时写死）。
   *
   * 为什么不缓存：`save.useAdapter('resource', …)` 可以随时换（装云插件时换一次），
   * 缓存住就会一直用旧后端 —— 那正是"云端换不动资源存哪"的老毛病。
   *
   * 传法有两种，都为历史与测试保留：
   * - `new ResourceStore(() => save.adapterOf('resource'), urlBackend)` —— 现取（生产用这个）；
   * - `new ResourceStore(urlBackend)` —— 只给 URL backend，没有资源后端（老测试用）。
   */
  constructor(
    backendResolverOrBackend?: (() => ResourceAdapter | undefined) | ResourceUrlBackend,
    /** 老形态：显式给的 URL backend（浏览器里是 createObjectURL）；缺省用 no-op */
    backend?: ResourceUrlBackend,
  ) {
    if (typeof backendResolverOrBackend === 'function') {
      this.backendResolver = backendResolverOrBackend
      this.backend = backend ?? noopBackend
    } else {
      this.backendResolver = () => undefined
      this.backend = backendResolverOrBackend ?? backend ?? noopBackend
    }
  }

  /** 当前资源后端（每次现取 —— 见构造函数说明） */
  private adapter(): ResourceAdapter | undefined {
    return this.backendResolver()
  }

  /**
   * 存一份资源字节 → 持久引用（写进节点 data 的 resourceId）。
   *
   * 云端回的是同源 URL（`/api/canvases/<画布id>/resources/<哈希>`），本地回 `res-<n>` id；
   * 两种情况都由 resolve 换成当前可显示地址。
   * 没有可用后端（极简宿主 / 单测）时抛错 —— 不静默造一个用不了的引用。
   */
  async put(blob: Blob, opts: ResourcePutOptions = {}): Promise<string> {
    const adapter = this.adapter()
    if (!adapter?.putResource) {
      throw new Error('[resources] 当前 resource 类型的 adapter 不支持存资源（未装资源后端？）')
    }
    const ref = await adapter.putResource(blob, opts)
    // 登记进内存表：本会话内 resolve 快、也能被引用扫描回收。
    // derived 要一起记：回收时按它跳过（派生资源不靠节点引用，见该字段说明）。
    this.entries.set(ref, {
      id: ref,
      kind: opts.kind ?? 'blob',
      url: '',
      resource: blob,
      ...(opts.derived ? { derived: true } : {}),
    })
    return ref
  }

  /**
   * 持久引用 → 当前可用的显示地址。
   *
   * 本地是**新建一个临时 objectURL**（刷新后由下一次 resolve 重建）；
   * 云端是把引用拼成服务器地址（稳定，不必下载字节）。
   */
  async resolve(ref: string): Promise<string | undefined> {
    if (!ref) return undefined
    const remembered = this.entries.get(ref)
    if (remembered?.url) return remembered.url
    const url = await this.adapter()?.resolveResource?.(ref)
    if (!url) return undefined
    this.entries.set(ref, {
      id: ref,
      kind: remembered?.kind ?? 'blob',
      url,
      ...(remembered?.resource !== undefined ? { resource: remembered.resource } : {}),
      ...(remembered?.derived ? { derived: true } : {}),
    })
    return url
  }


  /**
   * 【旧接口，保留兼容】登记一个**已拿到的显示地址**（不落字节）。
   *
   * 新代码请用 `put`（存字节 → 拿持久引用）。这个方法存在的唯一理由是：
   * 调用方手里已经有 url、只想登记进表以便统一回收（早期 file-drop 的用法）。
   *
   * ⚠️ **它不写后端**：返回的 id 只在本会话的表里有效，刷新即失效。
   * 想“刷新不丢”必须走 `put` —— 旧实现会在这里偷偷 `put` 一次，
   * 结果**返回的 id 与实际落库的引用不是同一个**：调用方拿着 id 什么也查不到，
   * 还留下一份无法回收的孤儿字节。现在不再那样做。
   */
  register(input: RegisterResourceInput): string {
    const kind = input.kind ?? 'blob'
    let url = input.url
    if (url === undefined) {
      if (!this.backend.createUrl) {
        throw new Error('[resources] 需显式传 url，或给 backend.createUrl 以自动生成')
      }
      url = this.backend.createUrl(input.resource)
    }
    this.seq += 1
    const id = `${ID_PREFIX}${this.seq}-${randomSuffix()}`
    this.entries.set(id, { id, kind, url, ...(input.resource !== undefined ? { resource: input.resource } : {}) })
    return id
  }

  get(id: string): ResourceEntry | undefined {
    return this.entries.get(id)
  }

  async flush(id: string): Promise<void> {
    await this.pending.get(id)
  }

  url(id: string): string | undefined {
    return this.entries.get(id)?.url
  }

  alive(id: string): boolean {
    return this.entries.has(id)
  }

  ids(): string[] {
    return [...this.entries.keys()]
  }

  revoke(id: string): boolean {
    const entry = this.entries.get(id)
    if (!entry) return false
    this.entries.delete(id)
    this.backend.revokeUrl(entry.url)
    void this.adapter()?.removeResource?.(id).catch(() => {})
    return true
  }

  revokeByResource(resource: unknown): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      if (entry.resource === resource) {
        this.entries.delete(id)
        this.backend.revokeUrl(entry.url)
        void this.adapter()?.removeResource?.(id).catch(() => {})
        n += 1
      }
    }
    return n
  }

  revokeByKind(kind: string): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      if (entry.kind === kind) {
        this.entries.delete(id)
        this.backend.revokeUrl(entry.url)
        void this.adapter()?.removeResource?.(id).catch(() => {})
        n += 1
      }
    }
    return n
  }

  disposeUnreferenced(referenced: ReadonlySet<string>): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      // 派生资源（缩略图/帧图）不参与：它们本来就不写进节点的 resourceId，
      // 拿"没被引用"当判据会把它们全部误杀（刚生成就被清、下次打开又重算）。
      if (entry.derived) continue
      if (!referenced.has(id)) {
        this.entries.delete(id)
        this.backend.revokeUrl(entry.url)
        void this.adapter()?.removeResource?.(id).catch(() => {})
        n += 1
      }
    }
    return n
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.backend.revokeUrl(entry.url)
    this.entries.clear()
  }

  /**
   * 刷新后按持久引用重建显示地址。
   *
   * 与 resolve 是同一件事（ref → 现算地址）；保留这个名字是因为宿主恢复流程按它调，
   * 语义上强调"这是载入时把临时地址重新算一遍"。
   */
  async restore(ref: string, _kind = 'blob'): Promise<string | undefined> {
    return this.resolve(ref)
  }
}

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return String(Date.now()) + "-" + String(Math.random()).slice(2)
}
