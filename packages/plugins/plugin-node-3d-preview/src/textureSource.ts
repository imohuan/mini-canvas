/**
 * textureSource —— 决定 3D 预览该贴哪张图（纯逻辑、Node 可单测）。
 *
 * 图从哪来有两处：
 * 1. 上游连进来的图片节点（用户在画布上把 image 节点连到本节点）—— 优先；
 * 2. 节点自己 data 里的图片地址（历史数据 / 直接写入）—— 兜底。
 *
 * 与老版 PanoramaNode 的取图优先级一致（connectedImageUrl || ownImageUrl）。
 * 抽成纯函数是为了不挂浏览器也能锁住这条"谁优先"的规则。
 */

/** 从上游/自身候选中挑出要用的贴图地址；都没有则返回空串（调用方显示占位） */
export function pickTextureUrl(ownUrl: unknown, upstreamUrl: unknown): string {
  const up = typeof upstreamUrl === 'string' ? upstreamUrl.trim() : ''
  if (up) return up
  const own = typeof ownUrl === 'string' ? ownUrl.trim() : ''
  return own
}

/**
 * 从"节点 id → 节点数据"的查表 + 边列表里，找出连到 targetId 输入口的第一张上游图。
 * 纯函数：不给 Vue/VueFlow/DOM，只认普通数组与对象，便于单测。
 *
 * @param edges     画布的边（至少含 source/target）
 * @param targetId  本节点 id
 * @param getData   按节点 id 取 data 的回调（渲染层用 renderNodes 查表）
 */
export function findUpstreamImageUrl(
  edges: ReadonlyArray<{ source: string; target: string }>,
  targetId: string,
  getData: (nodeId: string) => Record<string, unknown> | undefined,
): string {
  for (const e of edges) {
    if (e.target !== targetId) continue
    const url = getData(e.source)?.imageUrl
    if (typeof url === 'string' && url.trim()) return url
  }
  return ''
}

/** 上游图片候选：显示地址（迁移期旧字段）与持久引用（目标形态）二选一 */
export interface UpstreamImageRef {
  /** 旧字段里的显示地址；没有则为空串 */
  url: string
  /** 上游节点的持久资源引用；没有则为空串 */
  resourceId: string
}

/**
 * 找连到本节点的**第一张上游图**，把“地址 / 引用”原样带回来。
 *
 * 与 findUpstreamImageUrl 的区别：新节点只写 `resourceId`，只认 `imageUrl` 会把有图的上游
 * 当成空节点；调用方拿到引用后再按当前环境 resolve。
 */
export function findUpstreamImageRef(
  edges: ReadonlyArray<{ source: string; target: string }>,
  targetId: string,
  getData: (nodeId: string) => Record<string, unknown> | undefined,
): UpstreamImageRef | null {
  for (const e of edges) {
    if (e.target !== targetId) continue
    const data = getData(e.source)
    const url = typeof data?.imageUrl === 'string' ? data.imageUrl.trim() : ''
    const rawRef = data?.resourceId
    // 引用可能被上一代写入方写成数组 / 对象（MCP 与部分生成链路曾把多产物整包塞进来）：
    // 不是非空字符串就当没有，**不能** String() 一下拿 "[object Object]" 去解析。
    const resourceId = typeof rawRef === 'string' ? rawRef.trim() : ''
    if (url || resourceId) return { url, resourceId }
  }
  return null
}

/**
 * 从 `upstream.media('image')` 的返回里取出可交给图片解析器的字段。
 *
 * 为什么单独一个纯函数：上游能力只保证给 `resourceId`（持久引用），**不保证**给
 * 显示地址；而旧节点/旧宿主可能只有 `imageUrl`。两条路都收口到这里，组件里不再
 * 各写一份 `resourceId || imageUrl`（那种写法会把「引用」和「地址」混成一个字段，
 * 哪边为空都读不对）。
 */
export function upstreamSourceFields(
  media: { resourceId?: unknown; url?: unknown } | null | undefined,
): Record<string, unknown> | null {
  if (!media) return null
  const resourceId = typeof media.resourceId === 'string' ? media.resourceId.trim() : ''
  const url = typeof media.url === 'string' ? media.url.trim() : ''
  if (!resourceId && !url) return null
  return {
    ...(resourceId ? { resourceId } : {}),
    ...(url ? { imageUrl: url } : {}),
  }
}

/** 上游能力的一条产出（引用 / 地址可能只给一个，甚至都给） */
export interface UpstreamMediaLike {
  resourceId?: unknown
  url?: unknown
  imageUrl?: unknown
}

/**
 * 上游能力优先、按边扫描兜底：把两种来源收成一份**可直接交给解析器**的字段。
 *
 * 为什么要兜底，而不是"有能力就只认能力"：能力层要求本节点类型声明了 `consumes.image`
 * （当前已声明），但极简宿主 / 旧宿主 / 能力实现尚在灰度的组合下，`media()` 可能返回
 * undefined；这时按边读上游自己的 `resourceId`（新）或 `imageUrl`（旧）仍是正确行为。
 * 兜底**绝不回写**节点数据，也不猜字段以外的内容。
 *
 * 顺序（用户口径 2026-10-27）：新接口 → 能力 → 扫边；本函数负责后两层。
 */
export function resolveUpstreamImageFields(input: {
  /** 能力给的媒体（可能只有引用） */
  media?: UpstreamMediaLike | null
  /** 按边扫描得到的候选（极简宿主的兜底） */
  legacy?: UpstreamImageRef | null
}): Record<string, unknown> | null {
  return upstreamSourceFields(input.media ?? null) ?? upstreamSourceFields(input.legacy ?? null)
}
