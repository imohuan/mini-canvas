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
import { RESOURCE_URL_FIELDS, mediaKindOf, mediaUrlFieldsOf } from './resourceRefs'

// 「类型 → 地址字段」唯一一份在 resourceRefs；这里再导出，保持既有 import 路径可用。
export { mediaUrlFieldsOf }

/** URL 回收后端（浏览器实现包一层 URL.revokeObjectURL；测试用假实现） */
export interface ResourceUrlBackend {
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

/** 资源服务接口（ctx.get('resources')） */
export interface ResourceService {
  /** 等待资源字节写入持久化存储。 */
  flush?(id: string): Promise<void>
  /**
   * 这个引用是不是**本画布自己的**资源（画布就是文件夹，节点只许引用自己的东西）。
   * 后端没提供判断时按 `false` 处理 —— 宁可多复制一次，也不要留下跨画布的引用。
   */
  owns(ref: string): boolean
  /** 这个值是不是别人的资源地址（别的画布 / 外站）。用于保存前清理与打开时修复。 */
  isForeign(value: string): boolean
  /** 本画布的旧同源 URL → 持久引用；不是本画布 → undefined */
  normalizeRef(value: string): string | undefined
  /**
   * 把一份**外来**资源收进本画布：取字节 → `put()` → 返回本画布的持久引用。
   *
   * 已经是本画布资源 → 原样返回；取不到字节（外链失效 / 跨域）→ undefined，
   * 由调用方明确提示，绝不把外来地址写进节点。
   */
  adopt(refOrUrl: string, opts?: ResourceAdoptOptions): Promise<string | undefined>
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

/** `adopt` 的可选参数 */
export interface ResourceAdoptOptions {
  /** 资源种类（决定后端落盘扩展名 / 分类） */
  kind?: string
  /** 原始文件名 */
  name?: string
  /** 取字节（默认 fetch；测试注入假货）。返回 undefined = 取不到 */
  fetchBytes?: (url: string) => Promise<Blob | undefined>
}

// 媒体地址字段清单与「类型 → 字段」表都在 resourceRefs.ts（唯一一份）。
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

/** 节点 data 里存**资源引用**的字段（主引用与派生引用） */
export const RESOURCE_REF_FIELDS = ['resourceId', 'frameResourceId', 'leftResourceId', 'rightResourceId'] as const

/**
 * 保存前的资源归属清理：**画布就是文件夹**，节点里不许出现别人的地址。
 *
 * 做两件事：
 * 1. 媒体地址字段（`imageUrl` 等）指向别的画布 / 外站 → 删掉（地址只是本次渲染的副本，删了不丢字节）；
 * 2. 引用字段（`resourceId` 等）指向别的画布 → **保留**并记进返回值，交给打开时的修复流程
 *    先取字节、复制进本画布。现在就删会连“去哪儿取字节”的线索也一起丢掉。
 *
 * 已经是本画布的资源、本地 `res-`、`blob:`/`data:` 都不动（后两者由 sanitizeTransientResourceUrls 处理）。
 */
export function sanitizeForeignResourceRefs<T extends { id?: string; data?: Record<string, unknown> }>(
  nodes: T[],
  opts: { isForeign(value: string): boolean },
): { nodes: T[]; foreign: Array<{ id: string; field: string; value: string }> } {
  const foreign: Array<{ id: string; field: string; value: string }> = []
  const out = nodes.map((node) => {
    const data = node.data
    if (!data) return node
    const next = { ...data }
    for (const key of RESOURCE_URL_FIELDS) {
      const value = next[key]
      if (typeof value !== 'string' || !value) continue
    // 只保留**临时地址**（渲染时会重建）；能长期取回的资源一律以 resourceId 为准，
    // 地址不再当第二份真相落盘 —— 它可能指向别的画布 / 外站，是跨画布引用的入口。
    if (typeof next.resourceId === 'string' && next.resourceId) {
      delete next[key]
      continue
    }
      if (/^(blob:|data:)/i.test(value)) continue
      if (!opts.isForeign(value)) continue
      delete next[key]
    }
    for (const key of RESOURCE_REF_FIELDS) {
      const value = next[key]
      if (typeof value !== 'string' || !value) continue
      if (!opts.isForeign(value)) continue
      foreign.push({ id: String(node.id ?? ''), field: key, value })
    }
    return { ...node, data: next }
  })
  return { nodes: out, foreign }
}

/** 媒体地址字段 → 它对应的引用字段（修复时把字节收进来，写回哪个 ID） */
const URL_FIELD_TO_REF: Record<string, string> = {
  imageUrl: 'resourceId',
  videoUrl: 'resourceId',
  audioUrl: 'resourceId',
  panoUrl: 'resourceId',
  posterUrl: 'resourceId',
  thumbUrl: 'resourceId',
  maskUrl: 'resourceId',
  leftImageUrl: 'leftResourceId',
  rightImageUrl: 'rightResourceId',
}

export interface AdoptNodeResourcesResult<T> {
  nodes: T[]
  /** 成功迁进本画布的引用数 */
  adopted: number
  /** 迁不进来的（外链失效 / 跨域 / 后端不可用） */
  failed: Array<{ id: string; field: string; value: string }>
}

/**
 * 打开画布时的存量修复：把**外来**资源（别的画布 / 外站）复制进本画布。
 *
 * 只处理“确实需要搬”的值：已经是本画布的、`blob:`/`data:` 都不动。
 * 搬成功的引用换成新 ID；搬失败的清掉那个字段（地址字段一并删），
 * 由调用方汇总提示 —— 宁可显示空态，也不继续指向别人的文件夹。
 *
 * 这是“画布就是文件夹”的兜底：新写入由 adopt 拦住，老数据靠这里收口。
 */
export async function adoptNodeResources<T extends { id?: string; type?: string; data?: Record<string, unknown> }>(
  nodes: T[],
  port: {
    isForeign(value: string): boolean
    adopt(value: string, opts?: ResourceAdoptOptions): Promise<string | undefined>
    /** 本画布的值规范成持久引用（旧同源 URL → 逻辑 ID）；可选 */
    normalize?(value: string): string | undefined
  },
): Promise<AdoptNodeResourcesResult<T>> {
  let adopted = 0
  const failed: Array<{ id: string; field: string; value: string }> = []
  const out: T[] = []
  for (const node of nodes) {
    const data = node.data
    if (!data) {
      out.push(node)
      continue
    }
    const next: Record<string, unknown> = { ...data }
    const id = String(node.id ?? '')

    // ① 引用字段：先搬引用（它才是长期正身）
    for (const field of RESOURCE_REF_FIELDS) {
      const value = next[field]
      if (typeof value !== 'string' || !value) continue
      if (!port.isForeign(value)) {
        // 本画布的旧同源 URL 也升级成持久引用（地址不当第二份真相）
        const normalized = port.normalize?.(value)
        if (normalized && normalized !== value) {
          next[field] = normalized
          adopted += 1
        }
        continue
      }
      const made = await port.adopt(value, { kind: mediaKindOf(node.type, field) })
      if (made) {
        next[field] = made
        adopted += 1
      } else {
        delete next[field]
        failed.push({ id, field, value })
      }
    }

    // ② 媒体地址字段：没有可用引用时，用地址里的字节补一个；有引用就只把外来地址删掉
    for (const key of RESOURCE_URL_FIELDS) {
      const value = next[key]
      if (typeof value !== 'string' || !value) continue
      const refField = URL_FIELD_TO_REF[key] ?? 'resourceId'
      const existing = next[refField]
      if (!port.isForeign(value)) {
        // 本画布的地址：有可用引用就删掉地址；没有就把地址升级成引用
        const normalized = port.normalize?.(value)
        if (typeof existing === 'string' && existing && !port.isForeign(existing)) {
          delete next[key]
          continue
        }
        if (normalized) {
          next[refField] = normalized
          delete next[key]
          adopted += 1
        }
        continue
      }
      if (typeof existing === 'string' && existing && !port.isForeign(existing)) {
        delete next[key]
        continue
      }
      const made = await port.adopt(value, { kind: mediaKindOf(node.type, key) })
      if (made) {
        next[refField] = made
        delete next[key]
        adopted += 1
      } else {
        delete next[key]
        failed.push({ id, field: key, value })
      }
    }

    out.push({ ...node, data: next })
  }
  return { nodes: out, adopted, failed }
}

// 「类型 → 地址字段」这张表与 mediaUrlFieldsOf 收在 resourceRefs.ts（唯一一份，见那里的说明）。
// 这里保留同名再导出，避免下游 import 路径被迫改动。

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

/** no-op URL 后端（backend 未给时的占位：只在回收时被调用，什么都不做） */
const noopBackend: ResourceUrlBackend = {
  revokeUrl(): void { /* no-op */ },
}

export class ResourceStore implements ResourceService {
  private entries = new Map<string, ResourceEntry>()
  private backend: ResourceUrlBackend
  private pending = new Map<string, Promise<void>>()

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
   * 引用是否属于本画布。
   *
   * 后端提供了 `ownsResource` 就问它（云端按画布 id、本地认 `res-`）；
   * 没提供时一律当“不是本画布的” —— 宁可多复制一份，也不让跨画布引用漏进节点。
   */
  owns(ref: string): boolean {
    if (!ref) return false
    const adapter = this.adapter()
    // 没有资源后端（极简宿主 / 单测）时，本地取件码 `res-` 仍算本机的 —— 它本来就产自这个浏览器。
    if (!adapter?.ownsResource) return /^res-/.test(ref)
    try {
      return adapter.ownsResource(ref)
    } catch {
      return false
    }
  }

  /**
   * 这个值是不是**别人的**资源地址（别的画布、外站）。
   *
   * 只判“看起来是资源”的值；普通路径 / 空串 / 临时地址返回 false，交给调用方另行处理。
   * 画布 URL 会先剥掉协议与域名，按里面的画布 id 判断 —— 同源绝对地址不能当成外站。
   */
  isForeign(value: string): boolean {
    const v = (value ?? '').trim()
    if (!v || /^(blob:|data:)/i.test(v)) return false
    const canvasUrl = /(?:^https?:\/\/[^/]+)?\/api\/canvases\/([A-Za-z0-9_-]{1,64})\/resources\/([^/?#]+)$/.exec(v)
    if (canvasUrl) return !this.owns(canvasUrl[1] + '/' + canvasUrl[2])
    if (/^https?:\/\//i.test(v)) return true
    // 资产库自己的文件（`/api/assets/files/...`）：画布不能引用它，
    // 否则删掉那条资产，画布里的图就没了。要用就先复制进本画布。
    if (/^\/api\/assets\/files\//i.test(v)) return true
    if (/^res-/.test(v)) return !this.owns(v)
    // 云端逻辑 ID：`<画布id>/<内容哈希|槽位名>`
    if (/^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_.-]+$/.test(v)) {
      return !this.owns(v)
    }
    return false
  }

  /** 本画布的值规范成持久引用：后端给了 `normalizeRef` 就问它，其余原样返回。 */
  normalizeRef(value: string): string | undefined {
    const v = (value ?? '').trim()
    if (!v) return undefined
    const adapter = this.adapter()
    if (adapter?.normalizeRef) {
      try {
        return adapter.normalizeRef(v)
      } catch {
        return undefined
      }
    }
    return this.owns(v) ? v : undefined
  }

  /**
   * 把外来资源收进本画布（粘贴、拖资产库、导入包、生成产物写回都走这里）。
   *
   * 三种输入：本画布引用（原样返回）、能解析出显示地址的引用（先 resolve 再取字节）、
   * 能直接请求的地址（直接取字节）。取不到字节返回 undefined，绝不猜。
   */
  async adopt(refOrUrl: string, opts: ResourceAdoptOptions = {}): Promise<string | undefined> {
    const ref = (refOrUrl ?? '').trim()
    if (!ref) return undefined
    // 已经是本画布的东西：不重复存字节（视频可能几十 MB）
    if (this.owns(ref)) {
      // 旧同源 URL 顺手升级成持久引用（地址只是渲染副本，别当第二份真相）
      return this.normalizeRef(ref) ?? ref
    }
    let url: string | undefined
    if (/^(https?:|\/api\/|data:|blob:)/i.test(ref)) {
      url = ref
    } else {
      // 逻辑 ID / 本地取件码：先换成能取字节的地址
      try {
        url = await this.resolve(ref)
      } catch {
        url = undefined
      }
    }
    if (!url) return undefined
    let blob: Blob | undefined
    try {
      blob = opts.fetchBytes
        ? await opts.fetchBytes(url)
        : await fetch(url).then((r) => (r.ok ? r.blob() : undefined))
    } catch {
      blob = undefined
    }
    if (!blob) return undefined
    try {
      return await this.put(blob, {
        ...(opts.kind ? { kind: opts.kind } : {}),
        ...(opts.name ? { name: opts.name } : {}),
      })
    } catch {
      return undefined
    }
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

