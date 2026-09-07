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
  paddingTop: 36,
  paddingBottom: 16,
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
 * 选中集里"无祖先被选"的顶层节点（父被选时子随父移动，不单独位移避免双重偏移）。
 * 额外排除 parentId 存在但父未被选的孤立子节点？—— 不：若其父未选但该子被选，该子可独立移动，
 * 但它的 position 是相对父的局部坐标，改绝对坐标需换算；此场景先跳过（返回不含带父的节点），
 * 由 SelectionFrame 组件把带父节点排除在拖动外（v2 简版只支持顶层无父节点整组拖动）。
 */
export function draggableMembers(
  selectedIds: ReadonlySet<string>,
  allNodes: ReadonlyArray<MultiSelectNodeLike>,
): string[] {
  const out: string[] = []
  for (const n of allNodes) {
    if (!selectedIds.has(n.id)) continue
    if (n.parentId !== undefined) continue // 带父节点的位置是局部坐标：本轮简版不参与（见上方说明）
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
