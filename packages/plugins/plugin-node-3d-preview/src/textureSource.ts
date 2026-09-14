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
