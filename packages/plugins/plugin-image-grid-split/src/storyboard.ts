/**
 * storyboard —— 分镜组节点的槽位纯逻辑（零 Vue / 零 DOM，node 可单测）。
 *
 * 槽位模型：节点 data.slots = string|null[]，槽位数 = rows*cols；
 * 图片以持久资源引用存槽位。组件只管画格子与收鼠标，写库前先过这里。
 */

import { placeAdjacent } from '@mini-canvas/canvas-render'

/** 槽位数据形状（节点 data 里的 slots 字段） */
export interface StoryboardData {
  rows: number
  cols: number
  /** 每格的资源引用（null = 空） */
  slots: Array<string | null>
}

/** 读分镜组 data（非法返回 null：类型不匹配/字段缺失都不渲染网格） */
export function readStoryboard(data: Record<string, unknown> | undefined): StoryboardData | null {
  const rows = typeof data?.rows === 'number' ? data.rows : 0
  const cols = typeof data?.cols === 'number' ? data.cols : 0
  const slots = Array.isArray(data?.slots) ? data.slots : null
  if (rows < 1 || cols < 1 || rows > 8 || cols > 8 || !slots || slots.length !== rows * cols) return null
  // 元素收窄：非 string 的槽当空（写库时数据已经过 publish 校验，这里只兜显示）
  const clean: Array<string | null> = slots.map((s) => (typeof s === 'string' && s !== '' ? s : null))
  return { rows, cols, slots: clean }
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
