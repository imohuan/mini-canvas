/**
 * groupEngine —— 分组纯函数引擎。
 *
 * 职责边界：本文件只做"几何/换算/归属决策"的纯计算，不碰任何服务/Vue/存储，
 * 全部可 node 单测。服务编排（createGroup/ungroup/recalculateBounds 落到 nodeStore）
 * 在 groupPlugin.ts 里完成。
 *
 * 坐标约定（对齐 v2 内核与 VueFlow 父子语义）：
 * - 顶层节点 position = flow 绝对坐标；组内子节点 position = 相对父组的局部坐标，
 *   绝对位置 = 子 position 逐级累加父链。绝对 ↔ 相对的换算只走本文件
 *   toRelativePosition / toAbsolutePosition 一对函数（建组/解组/重算/拖拽归组共用）。
 * - 尺寸 w/h 由调用方给（渲染层 nodeLayout 实测/声明，引擎不关心来源）。
 */

/** 一个矩形的坐标与尺寸（flow 绝对坐标） */
export interface GroupRect {
  id: string
  x: number
  y: number
  w: number
  h: number
  /** 组嵌套深度（0=顶层组，1=嵌套一层）。命中决策用：深度深 = 渲染 z 高 = 视觉在上层，优先命中 */
  depth?: number
}

/** 分组包围盒结果：左上角 + 宽高 */
export interface GroupBounds {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 分组四周留白（px）。子节点内容到分组边框的距离，四边独立可配：
 * - top 通常比其它边大一点，给 BaseNode 标题条留位置（历史默认：top=40，其余 30）。
 * - 快捷键建组与拖拽自动归组共用同一份配置（插件 Config 登记进设置面板）。
 */
export interface GroupPadding {
  left: number
  right: number
  top: number
  bottom: number
}

/** 分组默认 padding（对齐老版视觉：四周 30，顶部额外 10 给标题条 → 40） */
export const DEFAULT_GROUP_PADDING: GroupPadding = { left: 30, right: 30, top: 40, bottom: 30 }

let groupSeq = 0

/** 生成一个分组节点 id（老版同款，避免与数字 id 撞车，肉眼可辨）。
 *  时间戳 + 序号 + 随机尾：同一毫秒内连续打组也不会撞 id（Node/浏览器实测踩过）。 */
export function createGroupId(now = Date.now()): string {
  groupSeq += 1
  return 'group-' + now + '-' + groupSeq
}

/**
 * 计算一组节点包围盒（考虑 padding）。
 * padding 四边独立：组左上角 = 内容包围盒左上 - (left, top)；
 * 宽高 = 内容包围盒 + left + right / top + bottom。小于 minW/minH 时抬到最小尺寸。
 */
export function computeGroupBounds(
  rects: GroupRect[],
  opts: { padding?: Partial<GroupPadding>; minW?: number; minH?: number } = {},
): GroupBounds | null {
  const { padding, minW = 200, minH = 150 } = opts
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

  // 逐边解析：缺省/非法（负数/NaN/Infinity/非数值）回落该边默认
  const pickEdge = (edge: number | undefined, fallback: number): number => {
    if (typeof edge !== 'number' || !Number.isFinite(edge) || edge < 0) return fallback
    return edge
  }
  const pad = {
    left: pickEdge(padding?.left, DEFAULT_GROUP_PADDING.left),
    right: pickEdge(padding?.right, DEFAULT_GROUP_PADDING.right),
    top: pickEdge(padding?.top, DEFAULT_GROUP_PADDING.top),
    bottom: pickEdge(padding?.bottom, DEFAULT_GROUP_PADDING.bottom),
  }

  const w = Math.max(maxX - minX + pad.left + pad.right, minW)
  const h = Math.max(maxY - minY + pad.top + pad.bottom, minH)
  return {
    x: minX - pad.left,
    y: minY - pad.top,
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

/** 分组预设色板（对齐老版 canvas-core/src/plugins/group/model.ts：前 7 个预设 + 1 自定义） */
export type GroupColorSwatch =
  | { kind: 'preset'; id: string; color: string; label: string }
  | { kind: 'custom'; id: 'custom'; label: string }

export const GROUP_COLOR_SWATCHES: GroupColorSwatch[] = [
  { kind: 'preset', id: 'slate', color: '#334155', label: '石板灰' },
  { kind: 'preset', id: 'blue', color: '#0ea5e9', label: '蓝色' },
  { kind: 'preset', id: 'red', color: '#ef4444', label: '红色' },
  { kind: 'preset', id: 'orange', color: '#f97316', label: '橙色' },
  { kind: 'preset', id: 'yellow', color: '#eab308', label: '黄色' },
  { kind: 'preset', id: 'green', color: '#22c55e', label: '绿色' },
  { kind: 'preset', id: 'violet', color: '#6366f1', label: '紫色' },
  { kind: 'custom', id: 'custom', label: '自定义' },
]

export const DEFAULT_GROUP_BACKGROUND_COLOR =
  GROUP_COLOR_SWATCHES[0].kind === 'preset' ? GROUP_COLOR_SWATCHES[0].color : '#334155'

/** 取分组底色：存了颜色用存的，否则回退默认石板灰（对齐老版 model.ts 语义） */
export function resolveGroupBackgroundColor(color: unknown): string {
  return typeof color === 'string' && color.trim() ? color : DEFAULT_GROUP_BACKGROUND_COLOR
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
    // 命中决策：与候选组全部求交，取"面积最小"的组 —— 嵌套场景下内层组面积更小、视觉上在最上层，
    // 鼠标落在内层组卡片上时应该命中内层组（外层组只是"背景容器"）。
    const bestHit = (excludeId?: string): GroupRect | undefined => {
      let best: GroupRect | undefined
      for (const g of groups) {
        if (g.id === n.id || g.id === excludeId) continue
        if (!rectIntersectsGroup(n.rect, g)) continue
        if (!best) { best = g; continue }
        // 优先深度深的组（渲染 z 更高、视觉在上层）；深度相同取面积小的（同类组之间内层更"具体"）
        const gDepth = g.depth ?? 0
        const bDepth = best.depth ?? 0
        if (gDepth > bDepth || (gDepth === bDepth && g.w * g.h < best.w * best.h)) best = g
      }
      return best
    }
    // 已属于某组：先判是否完全离开父组
    if (n.currentParentId) {
      const parent = groups.find((g) => g.id === n.currentParentId)
      if (parent && !rectIntersectsGroup(n.rect, parent)) {
        changes.push({ nodeId: n.id, leaveGroupId: parent.id })
        // 离开父组后：如果同时落在另一个组里 → 一起给出 join（转组一次完成）
        const next = bestHit(parent.id)
        if (next) changes.push({ nodeId: n.id, joinGroupId: next.id })
      }
      // 仍在父组内 → 默认无动作。但若命中了"更深"的组（父的子组，深度 > 父）→ 转入该子组：
      // 用户场景：外层组 ⊃ 第一层组，外层组的成员拖到第一层组上应加入它（它渲染 z 更高、视觉在最上）。
      // 注意 exclude 父本身；只接受 depth > 父 depth 的命中（命中同级/更浅的组说明只是路过外层组区域）。
      const deeper = bestHit(n.currentParentId)
      const parentDepth = parent?.depth ?? 0
      if (deeper && (deeper.depth ?? 0) > parentDepth) {
        changes.push({ nodeId: n.id, joinGroupId: deeper.id })
      }
      continue
    }
    // join 决策：有父时排除当前父（离开后允许加入别的组 —— 组内节点拖到另一个组 = 转组）；
    // 无父时在全部相交组中取最内层。
    const join = bestHit(n.currentParentId)
    if (join) changes.push({ nodeId: n.id, joinGroupId: join.id })
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
