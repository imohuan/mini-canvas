/**
 * storyboard —— 分镜组节点的槽位纯逻辑（零 Vue / 零 DOM，node 可单测）。
 *
 * 槽位模型（用户口径 2026-10-30）：
 * - 分镜组是一个**容器节点**，图片仍是画布上真正的 image 节点；
 * - data.slots = Array<string|null>，存的是**子节点 id**（不是图片数据）；
 * - 子节点 parentId 指向分镜组，坐标相对分镜组，尺寸固定成槽位大小；
 * - 拖进某槽 → 吸附对齐；拖到已有节点的槽 → 两者换位；拖出卡片 → 脱离。
 *
 * 好处：撤销/保存/复制/删除全走已有的节点机制，不需要并行一套"格子里的图"。
 */

import { placeAdjacent } from '@mini-canvas/canvas-render'

/** 槽位数据形状（节点 data 里的 slots 字段） */
export interface StoryboardData {
  rows: number
  cols: number
  /** 每格占用的子节点 id（null = 空槽） */
  slots: Array<string | null>
}

/** 读分镜组 data（非法返回 null：类型不匹配/字段缺失都不渲染网格） */
export function readStoryboard(data: Record<string, unknown> | undefined): StoryboardData | null {
  const rows = typeof data?.rows === 'number' ? data.rows : 0
  const cols = typeof data?.cols === 'number' ? data.cols : 0
  const slots = Array.isArray(data?.slots) ? data.slots : null
  if (rows < 1 || cols < 1 || rows > 8 || cols > 8 || !slots || slots.length !== rows * cols) return null
  // 元素收窄：非 string 的槽当空（写库时数据已经过校验，这里只兜显示）
  const clean: Array<string | null> = slots.map((s) => (typeof s === 'string' && s !== '' ? s : null))
  return { rows, cols, slots: clean }
}

/**
 * 分镜组的布局参数（全部可配置：设置面板「布局/分镜组」）。
 *
 * 默认值对齐图片节点的留白习惯；标题条占位用 topPadding 单独给
 * （用户口径 2026-10-30：「隐藏标题的那些」特殊情况也要能配）。
 */
export interface StoryboardLayout {
  /** 行间距（px） */
  rowGap: number
  /** 列间距（px） */
  colGap: number
  /** 内边距（卡片边框到槽位网格，px） */
  padding: number
  /** 顶部额外留白（给标题条；隐藏标题时可调小） */
  topPadding: number
}

/** 设置面板键（带插件前缀防撞全局命名空间） */
export const STORYBOARD_LAYOUT_KEYS = Object.freeze({
  rowGap: 'storyboardRowGap',
  colGap: 'storyboardColGap',
  padding: 'storyboardPadding',
  topPadding: 'storyboardTopPadding',
})

/** 读不到配置时的默认值 */
export const DEFAULT_STORYBOARD_LAYOUT: StoryboardLayout = Object.freeze({
  rowGap: 10,
  colGap: 10,
  padding: 8,
  topPadding: 34,
})

/** 从配置读取器解析布局参数（单项独立回落，被改坏不影响其它项） */
export function resolveStoryboardLayout(get: (key: string) => unknown): StoryboardLayout {
  const num = (key: string, fallback: number): number => {
    const v = get(key)
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  }
  return {
    rowGap: num(STORYBOARD_LAYOUT_KEYS.rowGap, DEFAULT_STORYBOARD_LAYOUT.rowGap),
    colGap: num(STORYBOARD_LAYOUT_KEYS.colGap, DEFAULT_STORYBOARD_LAYOUT.colGap),
    padding: num(STORYBOARD_LAYOUT_KEYS.padding, DEFAULT_STORYBOARD_LAYOUT.padding),
    topPadding: num(STORYBOARD_LAYOUT_KEYS.topPadding, DEFAULT_STORYBOARD_LAYOUT.topPadding),
  }
}

/** 从宿主服务表读布局参数（无 settings 服务时整体回落默认） */
export function readStoryboardLayout(ctx: { get?<T = unknown>(name: string): T } | undefined): StoryboardLayout {
  const settings = ctx?.get<{ get(key: string): unknown } | undefined>('settings')
  if (!settings || typeof settings.get !== 'function') return { ...DEFAULT_STORYBOARD_LAYOUT }
  return resolveStoryboardLayout((key) => settings.get(key))
}

/** 槽位矩形（相对分镜组左上角，px） */
export interface SlotRect {
  index: number
  x: number
  y: number
  w: number
  h: number
}

/**
 * 由分镜组尺寸 + 行列算出每个槽位的矩形。
 *
 * 槽位是等分格子：宽 = (W - 2*pad - (cols-1)*gap) / cols，高同理。
 * 卡片太小导致宽高 <= 0 时返回空表（组件不渲染网格，防负尺寸）。
 */
export function slotRects(
  boardW: number,
  boardH: number,
  rows: number,
  cols: number,
  layout?: Partial<StoryboardLayout> | null,
): SlotRect[] {
  if (!Number.isFinite(boardW) || !Number.isFinite(boardH) || boardW <= 0 || boardH <= 0) return []
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return []
  const d = { ...DEFAULT_STORYBOARD_LAYOUT, ...(layout ?? {}) }
  const padLeft = d.padding
  const padRight = d.padding
  const padTop = d.padding + d.topPadding
  const padBottom = d.padding
  const rowGap = Math.max(0, d.rowGap)
  const colGap = Math.max(0, d.colGap)
  const innerW = boardW - padLeft - padRight - (cols - 1) * colGap
  const innerH = boardH - padTop - padBottom - (rows - 1) * rowGap
  if (innerW <= 0 || innerH <= 0) return []
  const w = innerW / cols
  const h = innerH / rows
  if (w <= 0 || h <= 0) return []
  const out: SlotRect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out.push({
        index: r * cols + c,
        x: padLeft + c * (w + colGap),
        y: padTop + r * (h + rowGap),
        w,
        h,
      })
    }
  }
  return out
}

/** 点在哪个槽位里（相对分镜组坐标，越界 -1） */
export function slotIndexAt(rects: SlotRect[], localX: number, localY: number): number {
  for (const r of rects) {
    if (localX >= r.x && localX <= r.x + r.w && localY >= r.y && localY <= r.y + r.h) return r.index
  }
  return -1
}

/**
 * 拖动悬停时的目标槽判定：**交叉面积最大者获胜**（用户口径 2026-10-30）。
 *
 * 与 decideSnap 的"中心点落格"不同，这是拖动过程（NodeDrag 事件）用的：
 * 拖着一张大图滑过分镜组时，被盖住最多的是哪格，哪格就亮 —— 直觉、可预判。
 *
 * @param dragging 拖动节点的绝对矩形（NodeDrag 事件的 position 是左上角；尺寸来自调用方）
 * @returns 获胜槽位 index；没有交叉返回 -1
 */
export function slotIndexByOverlap(
  rects: SlotRect[],
  boardAbs: { x: number; y: number },
  dragging: { x: number; y: number; w: number; h: number },
): number {
  let best = -1
  let bestArea = 0
  for (const r of rects) {
    const rx = boardAbs.x + r.x
    const ry = boardAbs.y + r.y
    const overlapW = Math.min(dragging.x + dragging.w, rx + r.w) - Math.max(dragging.x, rx)
    const overlapH = Math.min(dragging.y + dragging.h, ry + r.h) - Math.max(dragging.y, ry)
    if (overlapW <= 0 || overlapH <= 0) continue
    const area = overlapW * overlapH
    if (area > bestArea) { bestArea = area; best = r.index }
  }
  return best
}

/**
 * 决策层同样改用交叉面积（松手判定与悬停判定必须一致，否则"亮的格子"和"落进的格子"会不同）。
 * 中心点判定保留为兜底：矩形信息缺失时退化用它。
 */
export function slotIndexByOverlapOrCenter(
  rects: SlotRect[],
  boardAbs: { x: number; y: number },
  dragging: { x: number; y: number; w: number; h: number } | null,
  center: { x: number; y: number },
): number {
  if (dragging && dragging.w > 0 && dragging.h > 0) {
    const hit = slotIndexByOverlap(rects, boardAbs, dragging)
    if (hit >= 0) return hit
    // 交叉为 0：交给 decideSnap 的卡片级判定（中心点在不在卡片里）处理，这里不猜
    return -1
  }
  return slotIndexAt(rects, center.x - boardAbs.x, center.y - boardAbs.y)
}

/**
 * 吸附决策：拖拽结束后该节点归谁。
 *
 * @returns
 *  - { kind: 'none' }              不在任何分镜组范围内、原本也不属于分镜组
 *  - { kind: 'snap', boardId, slotIndex, slots }   落进某槽（slots = 写库后的新分配）
 *  - { kind: 'detach' }            原本在分镜组里、拖出了卡片
 *
 * 规则（与用户口径一致）：
 *  1. 落点所在的格空 → 直接占该格；
 *  2. 落点所在的格被别的节点占着 → 两者换格（保持用户"互相拖拽排序"的直觉）；
 *  3. 落点在自己原来的格 → 不做任何事（避免无意义的历史记录）；
 *  4. 拖到卡片外 → 脱离，恢复自由节点。
 */
export type SnapDecision =
  | { kind: 'none' }
  | { kind: 'detach' }
  | { kind: 'snap'; boardId: string; slotIndex: number; slots: Array<string | null>; displacedNodeId: string | null }

/** decideSnap 的 boards 项（decideSnap 内部用 slotRects 时需要布局参数） */
export interface SnapBoard extends StoryboardData {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export function decideSnap(input: {
  /** 拖拽节点 id */
  nodeId: string
  /** 落点中心（画布绝对坐标） */
  center: { x: number; y: number }
  /** 该节点原本所属的分镜组 id（不在组里 = null） */
  currentBoardId: string | null
  /** 画布上所有分镜组：id + 绝对矩形 + 行列 + 当前 slots */
  boards: SnapBoard[]
  /** 槽位布局（行/列间距、内边距）；缺省用默认值 */
  layout?: Partial<StoryboardLayout> | null
  /** 拖动节点矩形（绝对坐标；给了就用**交叉面积最大**判定，否则退中心点） */
  dragRect?: { x: number; y: number; w: number; h: number } | null
}): SnapDecision {
  const { nodeId, center, currentBoardId, boards } = input
  // 命中哪个分镜组：取中心点落在其矩形内的那个（多个重叠时取后画的 = 数组靠后）
  let hit: (typeof boards)[number] | null = null
  for (const b of boards) {
    if (center.x < b.x || center.x > b.x + b.w) continue
    if (center.y < b.y || center.y > b.y + b.h) continue
    hit = b
  }

  if (!hit) {
    return currentBoardId ? { kind: 'detach' } : { kind: 'none' }
  }

  const rects = slotRects(hit.w, hit.h, hit.rows, hit.cols, input.layout)
  const slotIndex = slotIndexByOverlapOrCenter(rects, { x: hit.x, y: hit.y }, input.dragRect ?? null, center)
  if (slotIndex < 0) {
    // 落在卡片内但不在任何格（内边距区域）：视为该组最近格 → 用中心距离找最近槽
    const nearest = nearestSlot(rects, center.x - hit.x, center.y - hit.y)
    if (nearest < 0) return currentBoardId ? { kind: 'detach' } : { kind: 'none' }
    return snapTo(hit, nearest, nodeId, currentBoardId)
  }
  return snapTo(hit, slotIndex, nodeId, currentBoardId)

  function snapTo(
    board: (typeof boards)[number],
    index: number,
    movingId: string,
    fromBoardId: string | null,
  ): SnapDecision {
    const current = board.slots[index] ?? null
    // 已经在这一格：不动（同组拖回原格）
    if (current === movingId) return { kind: 'none' }
    const slots = [...board.slots]
    const displaced = current
    // 目标格有别的节点 → 换位；被顶掉的节点回到移动节点原来的格（同组时）
    if (displaced) {
      const originIndex = fromBoardId === board.id ? board.slots.indexOf(movingId) : -1
      if (originIndex >= 0) slots[originIndex] = displaced
    }
    slots[index] = movingId
    return { kind: 'snap', boardId: board.id, slotIndex: index, slots, displacedNodeId: displaced }
  }
}

/** 中心点最近的槽位（落在内边距时不至于判成"没命中"） */
function nearestSlot(rects: SlotRect[], localX: number, localY: number): number {
  let best = -1
  let bestD = Infinity
  for (const r of rects) {
    const cx = r.x + r.w / 2
    const cy = r.y + r.h / 2
    const d = (localX - cx) ** 2 + (localY - cy) ** 2
    if (d < bestD) { bestD = d; best = r.index }
  }
  return best
}

/** 从 slots 里去掉某个节点（脱离/删除时用），返回新数组或原数组 */
export function removeFromSlots(slots: Array<string | null>, nodeId: string): Array<string | null> {
  if (!slots.includes(nodeId)) return slots
  return slots.map((s) => (s === nodeId ? null : s))
}

/** placeAdjacent 只认这套形状：id + 左上角 + 宽高（flow 绝对坐标） */
export interface StoryboardPlacementRect {
  id?: string
  x: number
  y: number
  w: number
  h: number
}

/** placeStoryboardAt 的最小依赖（真宿主 ctx / 单测桩都满足） */
export interface StoryboardPlacementCtx {
  tryGet?(name: string): unknown
  get?(name: string): unknown
}

/** doc 服务里本函数用到的最小形状 */
interface StoryboardDocPort {
  getNode(id: string): { type?: string; position?: { x?: number; y?: number }; data?: Record<string, unknown>; size?: { w?: number; h?: number } } | undefined
  getNodes(): Array<{ id: string; type?: string; position?: { x?: number; y?: number }; data?: Record<string, unknown>; size?: { w?: number; h?: number } }>
  types?: ReadonlyMap<string, { defaultSize?: { w?: number; h?: number } }>
}

/** nodeLayout 服务里本函数用到的最小形状（实测/声明矩形，绝对坐标） */
interface StoryboardLayoutPort {
  getNodeRect(id: string): StoryboardPlacementRect | null | undefined
  getAllRects(): StoryboardPlacementRect[]
}

/** 视口服务里本函数用到的最小形状 */
interface StoryboardViewportPort {
  getViewport?(): { x: number; y: number; zoom: number; width?: number; height?: number }
}

function docPortOf(ctx: StoryboardPlacementCtx | undefined): StoryboardDocPort | undefined {
  if (!ctx) return undefined
  const doc = (typeof ctx.tryGet === 'function' ? ctx.tryGet('doc') : typeof ctx.get === 'function' ? ctx.get('doc') : undefined) as StoryboardDocPort | undefined
  return doc && typeof doc.getNodes === 'function' ? doc : undefined
}

function layoutPortOf(ctx: StoryboardPlacementCtx | undefined): StoryboardLayoutPort | undefined {
  if (!ctx) return undefined
  const port = (typeof ctx.tryGet === 'function' ? ctx.tryGet('nodeLayout') : typeof ctx.get === 'function' ? ctx.get('nodeLayout') : undefined) as StoryboardLayoutPort | undefined
  return port && typeof port.getAllRects === 'function' ? port : undefined
}

function viewportPortOf(ctx: StoryboardPlacementCtx | undefined): StoryboardViewportPort | undefined {
  if (!ctx) return undefined
  const port = (typeof ctx.tryGet === 'function' ? ctx.tryGet('viewport') : typeof ctx.get === 'function' ? ctx.get('viewport') : undefined) as StoryboardViewportPort | undefined
  return port && typeof port.getViewport === 'function' ? port : undefined
}

/** 节点矩形：layout 有实测用实测，否则按声明 size → 类型默认 → 兜底 320×240 */
function rectOfStoryboardNode(
  n: NonNullable<ReturnType<StoryboardDocPort['getNode']>> & { id: string },
  layout: StoryboardLayoutPort | undefined,
  types?: ReadonlyMap<string, { defaultSize?: { w?: number; h?: number } }>,
): StoryboardPlacementRect {
  const measured = layout?.getNodeRect(n.id)
  if (measured && measured.w > 0 && measured.h > 0) return measured
  const declared = n.size
  const def = types?.get(n.type ?? '')?.defaultSize
  return {
    id: n.id,
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    w: declared?.w ?? def?.w ?? 320,
    h: declared?.h ?? def?.h ?? 240,
  }
}

/** 分镜组节点的默认外框尺寸（与节点类型注册一致：480×360） */
const STORYBOARD_DEFAULT_SIZE = { w: 480, h: 360 }

/**
 * 分镜组节点的落点：源图右侧优先（与发布图片节点同一套 placeAdjacent 语义），
 * 避让画布上已有节点。布局/视口服务缺席时安全降级（只避让数据层矩形）。
 *
 * 旧实现把分镜组硬放在 (0,0)：源图不在原点时新组叠到别处或跑出视口（扫描记录 2026-10-30 C6b）。
 */
export function placeStoryboardAt(input: {
  ctx: StoryboardPlacementCtx | undefined
  sourceId: string
}): { x: number; y: number } {
  const doc = docPortOf(input.ctx)
  const layout = layoutPortOf(input.ctx)
  const viewport = viewportPortOf(input.ctx)
  const rectOfNode = (n: { id: string; type?: string; position?: { x?: number; y?: number }; size?: { w?: number; h?: number } }): StoryboardPlacementRect => ({
    id: n.id,
    x: n.position?.x ?? 0,
    y: n.position?.y ?? 0,
    w: n.size?.w ?? (doc?.types?.get(n.type ?? '')?.defaultSize?.w ?? 320),
    h: n.size?.h ?? (doc?.types?.get(n.type ?? '')?.defaultSize?.h ?? 240),
  })
  const nodes = doc?.getNodes() ?? (Array.isArray((input.ctx as { nodes?: unknown[] } | undefined)?.nodes) ? ((input.ctx as { nodes: Array<{ id: string; type?: string; position?: { x?: number; y?: number }; size?: { w?: number; h?: number } }> }).nodes) : [])
  const rects = layout?.getAllRects?.() ?? nodes.map(rectOfNode)
  const sourceNode = doc?.getNode?.(input.sourceId)
  const source = sourceNode
    ? rectOfStoryboardNode({ ...sourceNode, id: input.sourceId }, layout, doc?.types)
    : rects.find((r) => r.id === input.sourceId) ?? null
  const vp = viewport?.getViewport?.()
  const visible = vp && (vp.width ?? 0) > 0 && (vp.height ?? 0) > 0
    ? { x: -vp.x / vp.zoom, y: -vp.y / vp.zoom, w: vp.width! / vp.zoom, h: vp.height! / vp.zoom }
    : undefined
  const at = placeAdjacent({ size: STORYBOARD_DEFAULT_SIZE, source, obstacles: rects, visible })
  return { x: at.x, y: at.y }
}

/** 交换两格（返回新数组；同格/越界返回原表）。纯函数：调用方拿新数组走 doc.updateNode。 */
export function swapSlots(data: StoryboardData, a: number, b: number): Array<string | null> {
  const n = data.rows * data.cols
  if (a < 0 || b < 0 || a >= n || b >= n || a === b) return data.slots
  const next = [...data.slots]
  const tmp = next[a]!
  next[a] = next[b]!
  next[b] = tmp
  return next
}
