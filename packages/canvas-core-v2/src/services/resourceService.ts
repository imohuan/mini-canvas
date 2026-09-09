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

/** URL 生成/回收后端（浏览器实现包一层 URL.createObjectURL / revokeObjectURL；测试用假实现） */
export interface ResourceUrlBackend {
  /** 为资源生成一个 URL（缺省实现直通调用方给的 url 时可不实现） */
  createUrl?(resource: unknown): string
  /** 回收一个此前生成的 URL（必须实现；dispose/revoke 时调用） */
  revokeUrl(url: string): void
}

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
  /**
   * 登记一个资源。优先用传入 url；否则用 backend.createUrl(resource) 生成（backend 未实现且无 url → 抛错）。
   * @returns 资源 id（格式 res-{n}，可写进节点 data 作引用）
   */
  register(input: RegisterResourceInput): string
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
  private seq = 0

  constructor(backend?: ResourceUrlBackend) {
    this.backend = backend ?? noopBackend
  }

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
    const id = `${ID_PREFIX}${this.seq}`
    const entry: ResourceEntry = { id, kind, url, ...(input.resource !== undefined ? { resource: input.resource } : {}) }
    this.entries.set(id, entry)
    return id
  }

  get(id: string): ResourceEntry | undefined {
    return this.entries.get(id)
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
    return true
  }

  revokeByResource(resource: unknown): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      if (entry.resource === resource) {
        this.entries.delete(id)
        this.backend.revokeUrl(entry.url)
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
        n += 1
      }
    }
    return n
  }

  disposeUnreferenced(referenced: ReadonlySet<string>): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      if (!referenced.has(id)) {
        this.entries.delete(id)
        this.backend.revokeUrl(entry.url)
        n += 1
      }
    }
    return n
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.backend.revokeUrl(entry.url)
    this.entries.clear()
  }
}



