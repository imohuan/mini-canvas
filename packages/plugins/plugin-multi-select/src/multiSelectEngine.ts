/**
 * multiSelectEngine —— 多选插件的纯逻辑引擎（零 Vue / 零 DOM，Node 可单测）。
 *
 * 对齐老版 canvas-core/src/plugins/multi-select：
 * - 框选命中判定 = "局部相交"（矩形重叠面积 > 0 即选中），flow 坐标系。
 * - SelectionFrame 包围盒 = 选中节点绝对矩形并集 + 四周 padding。
 * - 整组拖动：只移动"顶层且祖先不在选中集"的节点（父被选则子随父动，避免双重位移）。
 */

/** flow 坐标矩形（坐标一律绝对坐标；尺寸 = 实测/声明，见 NodeLayoutService） */
export interface MultiSelectRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 命中/包围盒计算所需的最窄节点形状（含父引用判定） */
export interface MultiSelectNodeLike {
  id: string
  parentId?: string
}

/** 框选矩形（flow 坐标；由屏幕两点经 screenToFlow 换算 + min/max 归一，w/h 恒正） */
export interface FlowBox {
  x: number
  y: number
  w: number
  h: number
}

/** 框选 padding 配置（对齐老版 canvas.state.core.selectionFramePadding*） */
export interface SelectionFramePadding {
  paddingX: number
  paddingTop: number
  paddingBottom: number
}

export const DEFAULT_SELECTION_FRAME_PADDING: SelectionFramePadding = {
  paddingX: 16,
  paddingTop: 34,
  paddingBottom: 16,
}

/** 内框（小框）相对节点并集的外扩量；全 0 = 紧贴节点并集（默认，与老版一致） */
export const DEFAULT_SELECTION_FRAME_INNER_PADDING: SelectionFramePadding = {
  paddingX: 0,
  paddingTop: 0,
  paddingBottom: 0,
}

/** 两矩形是否局部相交（边缘恰好相接不算相交，与老版 isNodeInRect 一致） */
export function rectsOverlap(a: MultiSelectRect | FlowBox, b: MultiSelectRect | FlowBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * 框选碰撞检测：返回与 box 局部相交的全部矩形 id（顺序同输入）。
 * 用绝对坐标矩形（group 子节点经 nodeLayout 已算绝对坐标），与老版 computedPosition 等价。
 */
export function hitTestRects(rects: ReadonlyArray<MultiSelectRect>, box: FlowBox): string[] {
  const hits: string[] = []
  for (const r of rects) {
    if (rectsOverlap(r, box)) hits.push(r.id)
  }
  return hits
}

/** 选中节点矩形 → 包围盒（绝对坐标并集，无有效矩形返回 null） */
export function computeUnionBounds(rects: ReadonlyArray<MultiSelectRect>): MultiSelectRect | null {
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
  if (!Number.isFinite(minX)) return null
  return { id: '', x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 包围盒 + padding → 外框矩形（对齐老版 canvasBounds 计算） */
export function paddedBounds(
  bounds: MultiSelectRect,
  padding: SelectionFramePadding,
): MultiSelectRect {
  return {
    id: bounds.id,
    x: bounds.x - padding.paddingX,
    y: bounds.y - padding.paddingTop,
    w: bounds.w + padding.paddingX * 2,
    h: bounds.h + padding.paddingTop + padding.paddingBottom,
  }
}

/**
 * 群组框的内外两框几何（都是 flow 绝对坐标）。
 * - `inner`（小框）= 节点并集 + innerPadding（默认 outer 侧的 padding 为 0，即紧贴节点并集）。
 * - `outer`（大框）= 内框 + gap，整组拖动的把手。
 * 两者的关系恒为 `outer - inner === gap`（大框就是被间距从内框外推出去的那一个）。
 *
 * 为什么逐层算而不是"外框减两倍 padding 反推内框"：那是把几何绕一圈又算回来，
 * 两边的 padding 一旦对不上就会算出比外框还大的内框（两框交叉错位）。
 * 这里从节点并集出发逐层往外加，每层都等于用户真正看到的那一圈。
 */
export interface SelectionFrameGeometry {
  outer: MultiSelectRect
  inner: MultiSelectRect
}

/**
 * 由选中节点矩形并集算出内外两框。空集或尺寸非法返回 null（不画框）。
 *
 * 三层几何：节点并集 → 内框(+innerPadding) → 外框(+gap)。
 * innerPadding 缺省为全 0 = 内框就是节点并集本身（默认观感；此时与老版、与本插件早先版本完全一致）。
 */
export function computeSelectionFrameGeometry(
  rects: ReadonlyArray<MultiSelectRect>,
  gap: SelectionFramePadding,
  innerPadding: SelectionFramePadding = DEFAULT_SELECTION_FRAME_INNER_PADDING,
): SelectionFrameGeometry | null {
  const union = computeUnionBounds(rects)
  if (!union) return null
  const inner = paddedBounds(union, innerPadding)
  return {
    inner,
    outer: paddedBounds(inner, gap),
  }
}

/** 某节点是否在 allNodes 中有"也被选中"的祖先（父链递归）。 */
export function hasSelectedAncestor(
  nodeId: string,
  selectedIds: ReadonlySet<string>,
  allNodes: ReadonlyArray<MultiSelectNodeLike>,
): boolean {
  const byId = new Map(allNodes.map((n) => [n.id, n]))
  let cur = byId.get(nodeId)
  const seen = new Set<string>([nodeId])
  while (cur?.parentId) {
    if (seen.has(cur.parentId)) return false // 环保护
    seen.add(cur.parentId)
    if (selectedIds.has(cur.parentId)) return true
    cur = byId.get(cur.parentId)
  }
  return false
}

/**
 * 整组拖动应移动的节点 id：
 * 选中集里"无祖先被选"的全部节点（父被选时子随父移动，不单独位移避免双重偏移）。
 * 带父节点（父未被选）也参与：位移按"绝对坐标"视觉移动 + 落盘写绝对坐标，
 * 松手后逐节点广播 NodeDragEnd，由成员归属插件（plugin-group）按新位置重算 join/leave
 * 并把 store 坐标纠正成正确的相对/绝对（脱离原组 → 绝对；仍在组内 → 相对）。
 */
export function draggableMembers(
  selectedIds: ReadonlySet<string>,
  allNodes: ReadonlyArray<MultiSelectNodeLike>,
): string[] {
  const out: string[] = []
  for (const n of allNodes) {
    if (!selectedIds.has(n.id)) continue
    if (hasSelectedAncestor(n.id, selectedIds, allNodes)) continue
    out.push(n.id)
  }
  return out
}

/** 节点集 → 矩形集（输入节点含绝对位置 + 尺寸；组件从 nodeLayout.getAllRects 拿现成矩形，这里供测试/备用） */
export function toRects(
  nodes: ReadonlyArray<MultiSelectNodeLike & { x: number; y: number; w: number; h: number }>,
): MultiSelectRect[] {
  return nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }))
}
