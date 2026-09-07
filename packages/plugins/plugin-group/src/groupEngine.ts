/**
 * groupEngine —— 分组纯函数引擎（v2 复刻老版 canvas-core/src/plugins/group）。
 *
 * 职责边界：本文件只做"几何/换算/选择"的纯计算，不碰任何服务/Vue/存储，
 * 全部可 node 单测。服务编排（createGroup/ungroup/recalculateBounds 落到 nodeStore）
 * 在 groupPlugin.ts 里完成。
 *
 * 坐标约定（对齐 v2 内核）：
 * - 节点位置统一用 flow 绝对坐标（LayoutRect.x/y）；无父链概念由调用方负责拍平。
 * - 尺寸 w/h 由调用方给（渲染层 nodeLayout 实测/声明，引擎不关心来源）。
 */

/** 一个矩形的坐标与尺寸（flow 绝对坐标） */
export interface GroupRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 分组包围盒结果：左上角 + 宽高 */
export interface GroupBounds {
  x: number
  y: number
  w: number
  h: number
}

/** 生成一个分组节点 id（老版同款，避免与数字 id 撞车，肉眼可辨） */
export function createGroupId(now = Date.now()): string {
  return 'group-' + now
}

/**
 * 计算一组节点包围盒（考虑 padding）。
 * 老版：横向左右各 GROUP_PADDING，纵向顶部多 GROUP_PADDING_TOP 留给标题条。
 */
export function computeGroupBounds(
  rects: GroupRect[],
  opts: { padding?: number; paddingTop?: number; minW?: number; minH?: number } = {},
): GroupBounds | null {
  const { padding = 30, paddingTop = 10, minW = 200, minH = 150 } = opts
  if (rects.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of rects) {
    if (r.w <= 0 || r.h <= 0) continue
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  // 全部矩形尺寸非法（不存在可视成员）
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null

  const w = Math.max(maxX - minX + padding * 2, minW)
  const h = Math.max(maxY - minY + padding * 2 + paddingTop, minH)
  return {
    x: minX - padding,
    y: minY - padding - paddingTop,
    w,
    h,
  }
}

/**
 * 把子节点绝对坐标换算成相对分组左上角的局部坐标。
 * @param absX 子节点绝对 x
 * @param absY 子节点绝对 y
 * @param bounds 分组包围盒（左上角为相对基准）
 */
export function toRelativePosition(
  absX: number,
  absY: number,
  bounds: GroupBounds,
): { x: number; y: number } {
  return { x: absX - bounds.x, y: absY - bounds.y }
}

/** 从相对坐标还原绝对坐标 */
export function toAbsolutePosition(
  relX: number,
  relY: number,
  bounds: { x: number; y: number },
): { x: number; y: number } {
  return { x: relX + bounds.x, y: relY + bounds.y }
}

/**
 * 节点矩形是否与分组矩形相交（判定"是否可自动归组"）。
 * 老版用面积占比阈值 OVERLAP_RATIO（0=只要有重叠即算在内）。
 */
export function rectIntersectsGroup(
  node: GroupRect,
  group: GroupRect,
  overlapRatio = 0,
): boolean {
  const overlapLeft = Math.max(node.x, group.x)
  const overlapTop = Math.max(node.y, group.y)
  const overlapRight = Math.min(node.x + node.w, group.x + group.w)
  const overlapBottom = Math.min(node.y + node.h, group.y + group.h)
  if (overlapLeft >= overlapRight || overlapTop >= overlapBottom) return false
  const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
  const nodeArea = node.w * node.h
  if (nodeArea <= 0) return false
  return overlapArea / nodeArea > overlapRatio
}

/** 一个待判定节点的候选：绝对位置 + 原父节点 */
export interface GroupMembershipCandidate {
  id: string
  rect: GroupRect
  currentParentId?: string
}

/**
 * 拖拽结束后计算每个节点的归组归属：返回需要"加入/移出"分组的动作。
 * - 节点中心/面积落在某分组内 → 加入（返回 { nodeId, joinGroupId }）；
 * - 已在分组但面积已完全离开 → 移出（返回 { nodeId, leaveGroupId }）；
 * - 其它 → 无动作。
 * @param nodes 所有非分组节点（含当前父）
 * @param groups 所有分组节点矩形
 */
export function resolveGroupChanges(
  nodes: GroupMembershipCandidate[],
  groups: GroupRect[],
): Array<{ nodeId: string; joinGroupId?: string; leaveGroupId?: string }> {
  if (groups.length === 0) return []
  const changes: Array<{ nodeId: string; joinGroupId?: string; leaveGroupId?: string }> = []
  for (const n of nodes) {
    // 已属于某组：检查是否完全离开
    if (n.currentParentId) {
      const parent = groups.find((g) => g.id === n.currentParentId)
      if (parent && !rectIntersectsGroup(n.rect, parent)) {
        changes.push({ nodeId: n.id, leaveGroupId: parent.id })
      }
      continue
    }
    // 无父：找第一个相交的分组加入（一次只归一个组）
    const hit = groups.find((g) => g.id !== n.id && rectIntersectsGroup(n.rect, g))
    if (hit) changes.push({ nodeId: n.id, joinGroupId: hit.id })
  }
  return changes
}

/** 可下载子节点（老版 model.selectDownloadableGroupChildren 的 v2 等价）：返回带下载命令 id 的子节点 */
export function selectDownloadableGroupChildren<T extends { id: string; parentId?: string; type?: string; data?: Record<string, unknown> }>(
  nodes: T[],
  groupId: string,
  hasCommand: (commandId: string) => boolean,
): Array<{ node: T; commandId: string }> {
  return nodes.flatMap((node) => {
    if (node.parentId !== groupId) return []
    const type = node.data?.nodeType || node.type || ''
    const commandId = type + '.download'
    return type && hasCommand(commandId) ? [{ node, commandId }] : []
  })
}

/** 取一个节点的展示类型（兼容 data.nodeType 与 type 字段） */
export function getNodeType(node: { type?: string; data?: { nodeType?: string } }): string {
  return node.data?.nodeType || node.type || ''
}
