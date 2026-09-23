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

/** 跨页面保存 Blob 的后端。画布只保存资源 id，不把二进制塞进图数据。 */
export interface ResourcePersistence {
  save(id: string, kind: string, resource: Blob): Promise<void>
  load(id: string): Promise<{ kind: string; resource: Blob } | undefined>
  remove(id: string): Promise<void>
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
  /** 等待资源字节写入持久化存储。 */
  flush?(id: string): Promise<void>
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
  /** 刷新后按资源 id 重建 object URL。 */
  restore?(id: string, kind?: string): Promise<string | undefined>
}

const RESOURCE_URL_FIELDS = [
  "imageUrl", "videoUrl", "audioUrl", "posterUrl", "thumbUrl", "maskUrl",
  "panoUrl", "leftImageUrl", "rightImageUrl",
] as const
const MAX_INLINE_RESOURCE_BYTES = 64 * 1024

/** 保存画布前移除只在当前页面有效的 object URL；持久资源由 resourceId 重新加载。 */
export function sanitizeTransientResourceUrls<T extends { data?: Record<string, unknown> }>(nodes: T[]): T[] {
  return nodes.map((node) => {
    const data = node.data
    if (!data) return node
    const next = { ...data }
    for (const key of RESOURCE_URL_FIELDS) {
      if (typeof next[key] === "string") {
        const value = next[key] as string
        if (/^blob:/i.test(value) || (typeof next.resourceId === "string" && /^data:/i.test(value)) || (value.length > MAX_INLINE_RESOURCE_BYTES && /^data:/i.test(value))) delete next[key]
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
      if (url) data[key] = url
      else delete data[key]
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
  private persistence?: ResourcePersistence
  private pending = new Map<string, Promise<void>>()
  private seq = 0

  constructor(backend?: ResourceUrlBackend, persistence?: ResourcePersistence) {
    this.backend = backend ?? noopBackend
    this.persistence = persistence
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
    const id = `${ID_PREFIX}${this.seq}-${randomSuffix()}`
    const entry: ResourceEntry = { id, kind, url, ...(input.resource !== undefined ? { resource: input.resource } : {}) }
    this.entries.set(id, entry)
    if (this.persistence && typeof Blob !== "undefined" && input.resource instanceof Blob) {
      const task = this.persistence.save(id, kind, input.resource).catch(() => {})
      this.pending.set(id, task)
      void task.finally(() => this.pending.delete(id))
    }
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
    void this.persistence?.remove(id).catch(() => {})
    return true
  }

  revokeByResource(resource: unknown): number {
    let n = 0
    for (const [id, entry] of this.entries) {
      if (entry.resource === resource) {
        this.entries.delete(id)
        this.backend.revokeUrl(entry.url)
        void this.persistence?.remove(id).catch(() => {})
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
        void this.persistence?.remove(id).catch(() => {})
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
        void this.persistence?.remove(id).catch(() => {})
        n += 1
      }
    }
    return n
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.backend.revokeUrl(entry.url)
    this.entries.clear()
  }

  async restore(id: string, kind = "blob"): Promise<string | undefined> {
    const current = this.entries.get(id)
    if (current) return current.url
    let stored: { kind: string; resource: Blob } | undefined
    try {
      stored = await this.persistence?.load(id)
    } catch {
      return undefined
    }
    if (!stored || !this.backend.createUrl) return undefined
    const url = this.backend.createUrl(stored.resource)
    this.entries.set(id, { id, kind: stored.kind || kind, url, resource: stored.resource })
    return url
  }
}

function randomSuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return String(Date.now()) + "-" + String(Math.random()).slice(2)
}

/** 浏览器默认的 IndexedDB Blob 存储；Node/SSR 环境不启用。 */
export function createIndexedDbResourcePersistence(): ResourcePersistence | undefined {
  if (typeof indexedDB === "undefined") return undefined
  const DB_NAME = "mini-canvas-resources"
  const STORE_NAME = "blobs"
  let dbPromise: Promise<IDBDatabase> | undefined
  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return dbPromise
  }
  return {
    async save(id, kind, resource) {
      const db = await open()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        tx.objectStore(STORE_NAME).put({ kind, resource }, id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    },
    async load(id) {
      const db = await open()
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly")
        const request = tx.objectStore(STORE_NAME).get(id)
        request.onsuccess = () => resolve(request.result as { kind: string; resource: Blob } | undefined)
        request.onerror = () => reject(request.error)
      })
    },
    async remove(id) {
      const db = await open()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        tx.objectStore(STORE_NAME).delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    },
  }
}
