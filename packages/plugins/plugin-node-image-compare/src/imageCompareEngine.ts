/**
 * imageCompareEngine —— 图片对比节点的纯逻辑（零 Vue / 零 DOM / 零 three，Node 可单测）。
 *
 * 三件事：
 * 1. 从连进来的边里按"连线先后"取出前两张图（左/右）；
 * 2. 分割线位置的夹取；
 * 3. 超过上限时该挤掉哪几条（FIFO，先连的先挤）。
 *
 * FIFO 为什么要写成纯函数 + 由插件自己挤（重要，与老版有区别）：
 * v1 的 image-compare 靠 `context.on('connect')` 在连完之后删最老一条，校验层不设容量。
 * v2 内核的容量语义是"到顶就拒"（validateConnection 满额返回 limit-reached），没有"满了就挤最老"的选项，
 * 而落边口 commitEdge 会先用内核校验拦一道——所以"满了自动挤"这条在 v2 不会自己发生。
 * 本插件因此**不指望内核挤**：把容量声明为"可见上限 + 1 个缓冲位"，让第 3 条能落下来，
 * 再由插件订阅边变化把它挤掉，行为与老版一致。
 */

/** 真正显示的上限：左右各一张 */
export const MAX_COMPARE_IMAGES = 2
/**
 * 向内核声明的输入容量。= 可见上限 + 1 个缓冲位：
 * 留这一位，第 3 条连接才落得下来，插件才有机会"挤掉最老一条"（见文件头说明）。
 */
export const INPUT_CAPACITY = MAX_COMPARE_IMAGES + 1
/** 分割线位置范围（百分比） */
export const DIVIDER_MIN = 0
export const DIVIDER_MAX = 100
export const DIVIDER_DEFAULT = 50

/** 一条边的两端（只取本模块需要的字段，便于单测传普通对象） */
export interface CompareEdge {
  id: string
  source: string
  target: string
}

/** 一条入边的解析结果：贴哪张图 + 来自哪个上游节点 */
export interface CompareEntry {
  /** 上游节点 data.imageUrl */
  url: string
  /** 上游节点 id（左右小标签要指到"是哪个上游节点"，只按地址反查会同图认错人） */
  sourceId: string
}

/** 左/右两张图（为空串 = 该侧还没图） */
export interface ComparePair {
  left: string
  right: string
}

/**
 * 按"连线先后"取出连到 targetId 的前两张图地址。
 * 只认可作为图片的边（上游节点 data.imageUrl 非空），没有图的边跳过、不占位。
 *
 * @param edges    画布的边（按连线顺序）
 * @param targetId 本节点 id
 * @param getData  按节点 id 取 data 的回调
 */
export function resolveCompareEntries(
  edges: ReadonlyArray<CompareEdge>,
  targetId: string,
  getData: (nodeId: string) => Record<string, unknown> | undefined,
): CompareEntry[] {
  const list: CompareEntry[] = []
  for (const e of edges) {
    if (e.target !== targetId) continue
    const url = getData(e.source)?.imageUrl
    if (typeof url === 'string' && url.trim()) list.push({ url, sourceId: e.source })
    if (list.length >= MAX_COMPARE_IMAGES) break
  }
  return list
}

/** 只要两个地址时的便捷形态（左/右）；空串 = 该侧还没图 */
export function resolveComparePair(
  edges: ReadonlyArray<CompareEdge>,
  targetId: string,
  getData: (nodeId: string) => Record<string, unknown> | undefined,
): ComparePair {
  const list = resolveCompareEntries(edges, targetId, getData)
  return { left: list[0]?.url ?? '', right: list[1]?.url ?? '' }
}

/** 把分割线位置夹在 0~100（非法值回落默认 50） */
export function clampDivider(pct: number): number {
  if (!Number.isFinite(pct)) return DIVIDER_DEFAULT
  return Math.max(DIVIDER_MIN, Math.min(DIVIDER_MAX, pct))
}

/**
 * 超出上限时该挤掉哪些边（FIFO：保留最新 max 条，其余从最老的开始挤）。
 * @param incomingIds 目标输入口当前的全部入边 id，**按连线先后**排列
 * @param max         最多保留几条
 * @returns 需要删除的边 id（最老的在前）；没超限返回空数组
 */
export function planOverflowTrim(incomingIds: readonly string[], max: number = MAX_COMPARE_IMAGES): string[] {
  if (max <= 0) return [...incomingIds]
  if (incomingIds.length <= max) return []
  return incomingIds.slice(0, incomingIds.length - max)
}

/**
 * 从全部边里挑出"连到 targetId 输入口"的入边 id，按连线先后排列。
 * 与 resolveComparePair 同样只认带图的边，避免没有图的上游占着名额把有图的顶掉。
 */
export function incomingImageEdgeIds(
  edges: ReadonlyArray<CompareEdge>,
  targetId: string,
  getData: (nodeId: string) => Record<string, unknown> | undefined,
): string[] {
  return edges
    .filter((e) => e.target === targetId)
    .filter((e) => {
      const url = getData(e.source)?.imageUrl
      return typeof url === 'string' && url.trim().length > 0
    })
    .map((e) => e.id)
}
