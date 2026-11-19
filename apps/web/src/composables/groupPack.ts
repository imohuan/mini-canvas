/**
 * groupPack —— 「分组」收藏进资产库时用的整组数据包（纯函数，Node 可单测）。
 *
 * 用户口径（2026-11-15）：
 *   「分组节点可以收藏到我的资源里面，就类似于可视化节点那样的一个收藏功能……
 *     可视化节点拖拽出来只有一个节点，可是你的节点组拖拽出来是一整组的节点数据，
 *     添加的时候分类直接为节点组」。
 *
 * 所以这里不复制节点为图片，而是把**整棵子树**（组节点 + 它的后代节点 + 它们之间的连线）
 * 序列化成一个 JSON 包，拖回画布时按包重建。子节点 position 本来就是相对组的局部坐标，
 * 原样保存即可；重建时把组放到落点、子节点保持相对偏移，视觉不会散架。
 *
 * 为什么住在 apps/web：与 nodePack 同一条理由 —— 收藏入口在上传弹窗（成品应用的东西），
 * 而分组插件只负责画布内的分组语义，不需要知道资产库长什么样。
 */
import { uniqueLabel } from './nodeLabel'

/** 节点组资产的文件后缀（后台 mime 白名单与 kindOfName 同步认它） */
export const GROUP_PACK_EXT = '.plumegroup'
/** 资产类型名（后台 AssetKind / 前端筛选「节点组」共用） */
export const GROUP_PACK_KIND = 'node-group'

export interface GroupPackNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  size?: { w: number; h: number }
  parentId?: string
}

export interface GroupPackEdge {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  data?: Record<string, unknown>
}

/** 包内容（带格式标记与版本号：以后改结构时能明确拒绝旧包，而不是悄悄少画东西） */
export interface GroupPack {
  format: 'plume-group'
  /** v1 = 只有节点/边；v2 = 额外带 `media`（资源字节跟着包走） */
  version: 1 | 2
  /** 显示名（根的 label） */
  name: string
  /** 根组节点在原画布里的 id（重建时换成新 id） */
  rootId: string
  nodes: GroupPackNode[]
  edges: GroupPackEdge[]
  /** v2：组里用到的资源字节（导入时重新上传到当前画布，换成本画布的引用） */
  media?: GroupPackMedia[]
}

/** 包内的一份资源 */
export interface GroupPackMedia {
  /** 包内编号（节点 data 里写 `pack:<id>` 引用它） */
  id: string
  /** 资源种类（image / video / audio） */
  kind: string
  name?: string
  mime?: string
  /** 字节（base64）。包是单个 JSON 文件，拖一次就能带走全部素材 */
  bytesBase64: string
}

export interface BuildGroupPackInput {
  groupId: string
  nodes: ReadonlyArray<{
    id: string
    type: string
    position: { x: number; y: number }
    data?: Record<string, unknown>
    size?: { w: number; h: number }
    parentId?: string
  }>
  edges: ReadonlyArray<{
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    type?: string
    data?: Record<string, unknown>
  }>
  /** 不带后缀的显示名（缺省取根的 label，再缺省「分组」） */
  name?: string
}

/** 这个节点算不算「分组」：类型名或 data.nodeType 任一命中即可（与抽屉/分组服务同一套判据） */
export function isGroupNodeLike(node: { type?: string; data?: Record<string, unknown> }): boolean {
  if (!node) return false
  if (node.type === 'group') return true
  const t = node.data?.nodeType
  return t === 'group'
}

/**
 * 把某个分组连同**全部后代节点**、以及它们之间的连线打成包。
 *
 * 返回 null 的情形都是“这不是一个可收藏的分组”：id 不在列表里，或者它根本不是分组。
 * 半截数据不打包 —— 拖出来少几个子节点比不出现更让人困惑。
 */
export function buildGroupPack(input: BuildGroupPackInput): GroupPack | null {
  const byId = new Map(input.nodes.map((n) => [n.id, n]))
  const root = byId.get(input.groupId)
  if (!root || !isGroupNodeLike(root)) return null

  const picked = new Set<string>([input.groupId])
  const childrenOf = new Map<string, string[]>()
  for (const n of input.nodes) {
    if (!n.parentId) continue
    const arr = childrenOf.get(n.parentId) ?? []
    arr.push(n.id)
    childrenOf.set(n.parentId, arr)
  }
  // 逐层往下收：只认 parentId 链（与渲染层的父子语义一致），不做“几何上碰巧在框里”的猜测。
  const queue = [input.groupId]
  while (queue.length) {
    const id = queue.shift()!
    for (const kid of childrenOf.get(id) ?? []) {
      if (picked.has(kid)) continue
      picked.add(kid)
      queue.push(kid)
    }
  }

  const nodes: GroupPackNode[] = []
  for (const n of input.nodes) {
    if (!picked.has(n.id)) continue
    nodes.push({
      id: n.id,
      type: n.type,
      position: { x: n.position.x, y: n.position.y },
      data: { ...(n.data ?? {}) },
      ...(n.size ? { size: { w: n.size.w, h: n.size.h } } : {}),
      ...(n.parentId ? { parentId: n.parentId } : {}),
    })
  }

  const edges: GroupPackEdge[] = input.edges
    .filter((e) => picked.has(e.source) && picked.has(e.target))
    .map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      ...(e.type ? { type: e.type } : {}),
      ...(e.data ? { data: { ...e.data } } : {}),
    }))

  const label = typeof root.data?.label === 'string' ? root.data.label.trim() : ''
  return {
    format: 'plume-group',
    version: 1,
    name: (input.name ?? '').trim() || label || '分组',
    rootId: input.groupId,
    nodes,
    edges,
  }
}

/** 节点 data 里允许出现资源引用的字段（与 canvas-data 的 RESOURCE_REF_FIELDS 同口径） */
export const GROUP_RESOURCE_REF_FIELDS = ['resourceId', 'frameResourceId', 'leftResourceId', 'rightResourceId'] as const

/** 节点 data 里的媒体地址字段（这些只是渲染副本，打包时不带） */
const GROUP_MEDIA_URL_FIELDS = [
  'imageUrl', 'videoUrl', 'audioUrl', 'posterUrl', 'thumbUrl', 'maskUrl',
  'panoUrl', 'leftImageUrl', 'rightImageUrl',
] as const

/** 节点自己的资源种类（决定资源落到后端的扩展名 / 分类） */
export function groupMediaKindOf(node: { type?: string; data?: Record<string, unknown> }): string {
  if (node.type === 'video') return 'video'
  if (node.type === 'audio') return 'audio'
  return 'image'
}

/** 节点上要打包的资源引用（按字段顺序去重；`pack:` 前缀是旧包内的引用，不重复收） */
export function groupResourceRefsOf(node: { data?: Record<string, unknown> }): string[] {
  const out: string[] = []
  for (const field of GROUP_RESOURCE_REF_FIELDS) {
    const value = node.data?.[field]
    if (typeof value !== 'string' || !value || value.startsWith('pack:')) continue
    if (!out.includes(value)) out.push(value)
  }
  return out
}

/**
 * 把组里用到的资源字节收进包（v2）。
 *
 * 只收**这个组自己的节点**引用到的资源；节点的 `resourceId` 换成包内编号 `pack:<id>`，
 * 显示地址字段删掉 —— 包不携带任何画布地址，导入时一律重新 `put()` 到当前画布。
 *
 * @param fetchBytes 取字节（宿主给：`resources.adopt` 之后按引用取文件）；返回 undefined 表示取不到
 * @returns 打好的包，以及没能收进来的资源（调用方要明确提示，不静默生成坏包）
 */
export async function attachGroupMedia(
  pack: GroupPack,
  opts: {
    /** 取某引用对应的字节；取不到返回 undefined */
    fetchBytes: (resourceId: string, kind: string) => Promise<Blob | undefined>
  },
): Promise<{ pack: GroupPack; missing: Array<{ nodeId: string; resourceId: string }> }> {
  const media = new Map<string, GroupPackMedia>()
  const missing: Array<{ nodeId: string; resourceId: string }> = []
  // 同一个资源被多个节点引用时只打一份（视频可能几十 MB）
  const idOf = new Map<string, string>()
  const nodes: GroupPackNode[] = []
  for (const node of pack.nodes) {
    const data: Record<string, unknown> = { ...node.data }
    for (const field of GROUP_MEDIA_URL_FIELDS) delete data[field]
    for (const field of GROUP_RESOURCE_REF_FIELDS) {
      const ref = data[field]
      if (typeof ref !== 'string' || !ref || ref.startsWith('pack:')) continue
      let packId = idOf.get(ref)
      if (!packId) {
        const kind = groupMediaKindOf(node)
        const blob = await opts.fetchBytes(ref, kind)
        if (!blob) {
          missing.push({ nodeId: node.id, resourceId: ref })
          delete data[field]
          continue
        }
        packId = 'm' + (media.size + 1)
        media.set(packId, {
          id: packId,
          kind,
          bytesBase64: await blobToBase64(blob),
          ...(blob.type ? { mime: blob.type } : {}),
        })
        idOf.set(ref, packId)
      }
      data[field] = 'pack:' + packId
    }
    nodes.push({ ...node, data })
  }
  return {
    pack: { ...pack, version: 2, nodes, media: [...media.values()] },
    missing,
  }
}

/** Blob → base64（不依赖 Buffer；浏览器与 Node 都成立） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return typeof btoa === 'function' ? btoa(bin) : ''
}

/** base64 → Blob */
export function base64ToBlob(base64: string, mime?: string): Blob {
  const bin = typeof atob === 'function' ? atob(base64) : ''
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes as unknown as BlobPart], mime ? { type: mime } : {})
}

/** 解析一个分组包；结构不对 / 版本不认识 → 抛错（调用方提示用户，不静默建半个组） */
export function parseGroupPack(raw: unknown): GroupPack {
  const o = raw as Partial<GroupPack> | null
  if (!o || typeof o !== 'object') throw new Error('分组包内容不是对象')
  if (o.format !== 'plume-group') throw new Error('不是分组包')
  if (o.version !== 1 && o.version !== 2) throw new Error('分组包版本不支持：' + String(o.version))
  if (typeof o.rootId !== 'string' || !o.rootId) throw new Error('分组包缺少根节点')
  if (!Array.isArray(o.nodes) || !o.nodes.length) throw new Error('分组包里没有节点')
  const nodes: GroupPackNode[] = o.nodes.map((n) => {
    if (!n || typeof n !== 'object') throw new Error('分组包节点格式不对')
    const x = Number(n.position?.x)
    const y = Number(n.position?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('分组包节点缺少位置')
    return {
      id: String(n.id),
      type: String(n.type),
      position: { x, y },
      data: (n.data ?? {}) as Record<string, unknown>,
      ...(n.size && Number.isFinite(n.size.w) && Number.isFinite(n.size.h) ? { size: { w: n.size.w, h: n.size.h } } : {}),
      ...(typeof n.parentId === 'string' && n.parentId ? { parentId: n.parentId } : {}),
    }
  })
  const ids = new Set(nodes.map((n) => n.id))
  if (!ids.has(o.rootId)) throw new Error('分组包缺少根节点')
  const edges: GroupPackEdge[] = (Array.isArray(o.edges) ? o.edges : [])
    .filter((e) => e && ids.has(String(e.source)) && ids.has(String(e.target)))
    .map((e) => ({
      source: String(e.source),
      target: String(e.target),
      ...(typeof e.sourceHandle === 'string' ? { sourceHandle: e.sourceHandle } : {}),
      ...(typeof e.targetHandle === 'string' ? { targetHandle: e.targetHandle } : {}),
      ...(typeof e.type === 'string' ? { type: e.type } : {}),
      ...(e.data ? { data: e.data as Record<string, unknown> } : {}),
    }))
  return {
    format: 'plume-group',
    version: o.version === 2 ? 2 : 1,
    name: typeof o.name === 'string' && o.name ? o.name : '分组',
    rootId: o.rootId,
    nodes,
    edges,
    ...(o.version === 2 ? { media: parseGroupMedia(o.media) } : {}),
  }
}

/** 解析包里的资源表；结构不对的条目丢掉（不让一个坏条目把整包毁掉） */
function parseGroupMedia(raw: unknown): GroupPackMedia[] {
  if (!Array.isArray(raw)) return []
  const out: GroupPackMedia[] = []
  for (const item of raw) {
    const m = item as Partial<GroupPackMedia> | null
    if (!m || typeof m !== 'object') continue
    if (typeof m.id !== 'string' || !m.id) continue
    if (typeof m.bytesBase64 !== 'string' || !m.bytesBase64) continue
    out.push({
      id: m.id,
      kind: typeof m.kind === 'string' && m.kind ? m.kind : 'image',
      ...(typeof m.name === 'string' && m.name ? { name: m.name } : {}),
      ...(typeof m.mime === 'string' && m.mime ? { mime: m.mime } : {}),
      bytesBase64: m.bytesBase64,
    })
  }
  return out
}

export interface PlacedGroupNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  size?: { w: number; h: number }
  parentId?: string
  /** 资源引用换成会话可用地址后才有的瞬时播放地址（不落盘：resourceId 才是正身） */
  liveUrl?: string
}

export interface PlacedGroup {
  rootId: string
  nodes: PlacedGroupNode[]
  edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string; type?: string; data?: Record<string, unknown> }>
}

export interface PlanGroupPlacementOptions {
  /** 分组左上角要落在哪（flow 坐标） */
  origin: { x: number; y: number }
  /** 向数据层要新 id（保持与画布同一套短数字 id） */
  allocateId: () => string
  /** 画布上已有的显示名（根节点的名字要跟着去重，拖两次不会出现两个「分组 1」） */
  takenLabels?: Iterable<string>
  /**
   * 可选：把包里的 `resourceId` 换成本次会话能显示的地址。
   *
   * 为什么要换：节点的持久正身是 `resourceId`（本地是 IndexedDB 条目、云端是同源 URL），
   * 从别的画布/别的机器收藏过来的组，原画布的 `/api/canvases/<原id>/resources/...` 地址
   * 在本机可能是空的。换不到就保留原 `xxxUrl` 字段，至少不至于更差。
   */
  resolveResource?: (resourceId: string, nodeType: string) => Promise<string | undefined>
}

/**
 * 把包算成“要往画布写什么”：新 id、根节点落在 origin、子节点保持相对于根的偏移。
 *
 * 坐标为什么只挪根：包里的子节点本来存的就是**相对父组**的局部坐标（见 groupEngine 的约定），
 * 根一挪、子节点自然整体跟着走。给子节点再加 origin 会二次平移，拖出来的组会散开。
 */
export function planGroupPlacement(pack: GroupPack, opts: PlanGroupPlacementOptions): PlacedGroup {
  const idMap = new Map<string, string>()
  for (const n of pack.nodes) idMap.set(n.id, opts.allocateId())
  const rootId = idMap.get(pack.rootId)!

  const taken = new Set<string>()
  for (const t of opts.takenLabels ?? []) {
    const s = String(t ?? '').trim()
    if (s) taken.add(s)
  }

  const nodes: PlacedGroupNode[] = pack.nodes.map((n) => {
    const isRoot = n.id === pack.rootId
    const data = { ...(n.data ?? {}) }
    // 只有**整组的名字**要跟着画布去重（拖两次不能出现两个同名分组）；
    // 子节点保持收藏时的名字 —— 它们是这一组的内部内容，改名字反而让用户认不出原来那几张图。
    if (isRoot && typeof data.label === 'string' && data.label.trim()) {
      const next = uniqueLabel(data.label, taken)
      data.label = next
      taken.add(next)
    }
    return {
      id: idMap.get(n.id)!,
      type: n.type,
      position: isRoot ? { x: opts.origin.x, y: opts.origin.y } : { x: n.position.x, y: n.position.y },
      data,
      ...(n.size ? { size: { w: n.size.w, h: n.size.h } } : {}),
      ...(n.parentId && idMap.has(n.parentId) ? { parentId: idMap.get(n.parentId) } : {}),
    }
  })

  /**
   * ★ 父节点必须排在子节点**前面**。
   *
   * 包里的顺序来自 `doc.getNodes()`：先建的子节点在前、后建的组在后。原样 addNodes 时，
   * 渲染层会先看到一个「parent 还不存在」的子节点，控制台刷一串
   * `[Vue Flow]: Node is missing a parent`（真机验证时看到过）。
   * 这里做一次稳定拓扑排序：没有任何依赖的按原顺序先出，父出了才出子。
   */
  const ordered: PlacedGroupNode[] = []
  const emitted = new Set<string>()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const push = (n: PlacedGroupNode): boolean => {
    if (emitted.has(n.id)) return true
    if (n.parentId) {
      const parent = byId.get(n.parentId)
      // 父不在本组里（被跳过的未知类型）：保留原 parentId，交给调用方清理
      if (parent && !push(parent)) return false
    }
    emitted.add(n.id)
    ordered.push(n)
    return true
  }
  for (const n of nodes) push(n)

  const edges = pack.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
      ...(e.type ? { type: e.type } : {}),
      ...(e.data ? { data: { ...e.data } } : {}),
    }))

  return { rootId, nodes: ordered, edges }
}

/**
 * 把包里各节点的 `resourceId` 换成当前会话地址（异步版 planGroupPlacement 的前置补水）。
 *
 * 单独一步而不是塞进 planGroupPlacement：那边是纯函数（有单测）。取资源是 I/O，
 * 由调用方 await 完再把“补好 URL 的包”交进去，纯逻辑仍然好测。
 */
export async function hydrateGroupPackMedia(
  pack: GroupPack,
  resolve: (resourceId: string, nodeType: string) => Promise<string | undefined>,
): Promise<GroupPack> {
  const nodes: GroupPackNode[] = []
  for (const n of pack.nodes) {
    const resourceId = typeof n.data?.resourceId === 'string' ? n.data.resourceId : ''
    if (!resourceId) {
      nodes.push(n)
      continue
    }
    let url: string | undefined
    try {
      url = await resolve(resourceId, n.type)
    } catch {
      url = undefined
    }
    if (!url) {
      nodes.push(n)
      continue
    }
    // 只补“当前会话地址”这一个会话内字段（imageUrl / videoUrl / audioUrl），不覆盖别的数据。
    const key = n.type === 'video' ? 'videoUrl' : n.type === 'audio' ? 'audioUrl' : 'imageUrl'
    nodes.push({ ...n, data: { ...n.data, [key]: url } })
  }
  return { ...pack, nodes }
}
