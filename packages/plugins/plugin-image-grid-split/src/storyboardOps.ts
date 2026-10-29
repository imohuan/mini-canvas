/**
 * storyboardOps —— 分镜组节点的数据操作（纯逻辑 + 事务编排，零 Vue/DOM）。
 *
 * 分镜组与普通分组的区别只在这里：普通分组是一块可自由摆放的区域，分镜组是
 * **固定槽位的容器**，槽位自己会互相交换，也可以接收/吐出普通图片节点。
 *
 * 坐标约定与 group 一致：容器与子节点都按 parentId + 相对 position 表示。
 * 分镜组不改变图片节点的类型（它仍是普通 image 节点），只是把它收进容器、放到槽位坐标。
 */
import type { DocService } from '@mini-canvas/canvas-data'
import { STORYBOARD_NODE_TYPE, readStoryboardSlots, swapSlots, type StoryboardSlot } from './gridLogic'
import { storyboardPatchWithSlots } from './gridActions'

/** 只取用到的 doc 写口，避免测试桩被迫造整套 DocService */
export interface StoryboardDocPort {
  getNode(id: string): { id: string; type: string; parentId?: string; position: { x: number; y: number }; data: Record<string, unknown>; size?: { w: number; h: number } } | undefined
  getNodes(): Array<{ id: string; type: string; parentId?: string; position: { x: number; y: number }; data: Record<string, unknown>; size?: { w: number; h: number } }>
  transaction<T>(reason: string, fn: (tx: StoryboardTxPort) => T): T
  updateNodeData(id: string, data: Record<string, unknown>): void
  updateNode(id: string, patch: { parentId?: string | undefined; data?: Record<string, unknown>; position?: { x: number; y: number } }): void
}

export interface StoryboardTxPort {
  createNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string
  removeNodes(ids: string[]): number
  updateNode(id: string, patch: { parentId?: string | undefined; data?: Record<string, unknown>; position?: { x: number; y: number } }): void
}

export interface StoryboardGeometry {
  cellWidth: number
  cellHeight: number
  gap: number
  padding: number
}

/** 分镜组几何：优先读节点 data 里创建时记下的格子尺寸 */
export function geometryOf(data: Record<string, unknown> | undefined): StoryboardGeometry {
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback)
  return {
    cellWidth: num(data?.gridCellWidth, 320),
    cellHeight: num(data?.gridCellHeight, 240),
    gap: num(data?.gridGap, 8),
    padding: num(data?.gridPadding, 12),
  }
}

/** 某槽位的容器内局部坐标（左上角） */
export function slotLocalPosition(index: number, cols: number, geo: StoryboardGeometry): { x: number; y: number } {
  const c = Math.max(1, Math.round(cols))
  const i = Math.max(0, Math.floor(index))
  const row = Math.floor(i / c)
  const col = i % c
  return {
    x: Math.round(geo.padding + col * (geo.cellWidth + geo.gap)),
    y: Math.round(geo.padding + row * (geo.cellHeight + geo.gap)),
  }
}

export interface StoryboardMoveResult {
  ok: boolean
  reason?: string
  /** 写入的槽位下标；失败时 -1 */
  slotIndex: number
}

/**
 * 把一张普通图片节点拖入槽位（移动，不复制）。
 *
 * 规则：
 * - 目标槽已有图 → 拒绝（先让用户交换或清空，避免悄悄顶掉）；
 * - 图片已在别的普通分组里 → 拒绝（否则会把那张图从原组偷走，原组包围盒不更新）；
 * - 成功：图片 parentId 挂到分镜组，position 改为槽位局部坐标；同一事务一条历史。
 */
export function moveImageIntoSlot(
  doc: StoryboardDocPort,
  input: { storyboardId: string; imageNodeId: string; slotIndex: number },
): StoryboardMoveResult {
  const board = doc.getNode(input.storyboardId)
  if (!board || board.type !== STORYBOARD_NODE_TYPE) return { ok: false, reason: '分镜组不存在', slotIndex: -1 }
  const image = doc.getNode(input.imageNodeId)
  if (!image || image.type !== 'image') return { ok: false, reason: '只能把图片拖进分镜组', slotIndex: -1 }
  if (image.parentId && image.parentId !== input.storyboardId) return { ok: false, reason: '这张图已在别的分组里，请先拖出来', slotIndex: -1 }
  const rows = typeof board.data.rows === 'number' ? board.data.rows : 0
  const cols = typeof board.data.cols === 'number' ? board.data.cols : 0
  const total = Math.max(0, rows * cols)
  if (input.slotIndex < 0 || input.slotIndex >= total) return { ok: false, reason: '槽位不存在', slotIndex: -1 }
  const slots = readStoryboardSlots(board.data.slots, total)
  if (slots[input.slotIndex]) return { ok: false, reason: '这个槽位已经有图了', slotIndex: -1 }
  const resourceId = typeof image.data.resourceId === 'string' ? image.data.resourceId : ''
  if (!resourceId) return { ok: false, reason: '这张图没有资源引用，无法放进分镜', slotIndex: -1 }
  const geo = geometryOf(board.data)
  const local = slotLocalPosition(input.slotIndex, cols, geo)
  const nextSlots = [...slots]
  nextSlots[input.slotIndex] = {
    resourceId,
    name: typeof image.data.label === 'string' && image.data.label ? image.data.label : `宫格分镜 ${input.slotIndex + 1}`,
    ...(typeof image.data.imageWidth === 'number' ? { width: image.data.imageWidth } : {}),
    ...(typeof image.data.imageHeight === 'number' ? { height: image.data.imageHeight } : {}),
  }
  doc.transaction('storyboard-drop-image', (tx) => {
    tx.updateNode(input.storyboardId, { data: storyboardPatchWithSlots(nextSlots) })
    // 移动：把原图片节点收进分镜组，位置改为槽位坐标；不删除、不复制
    tx.updateNode(input.imageNodeId, { parentId: input.storyboardId, position: local })
  })
  return { ok: true, slotIndex: input.slotIndex }
}

/**
 * 从槽位拖出一张图：把对应图片子节点移回顶层（保留 resourceId），清空槽位。
 * 成功返回新建/复用的图片节点 id；如果没有对应子节点（旧存档只有 resourceId），
 * 通过 `createImageNode` 注入的创建器补建一个，不静默丢图。
 */
export function takeImageOutOfSlot(
  doc: StoryboardDocPort,
  input: {
    storyboardId: string
    slotIndex: number
    position: { x: number; y: number }
    createImageNode?: (resourceId: string, position: { x: number; y: number }, meta: { name?: string; width?: number; height?: number }) => string | undefined
  },
): { ok: boolean; nodeId?: string; reason?: string } {
  const board = doc.getNode(input.storyboardId)
  if (!board || board.type !== STORYBOARD_NODE_TYPE) return { ok: false, reason: '分镜组不存在' }
  const total = typeof board.data.rows === 'number' && typeof board.data.cols === 'number' ? board.data.rows * board.data.cols : 0
  const slots = readStoryboardSlots(board.data.slots, total)
  const slot = slots[input.slotIndex]
  if (!slot) return { ok: false, reason: '这个槽位是空的' }
  const child = doc.getNodes().find((n) => n.parentId === input.storyboardId && n.type === 'image' && n.data.resourceId === slot.resourceId)
  const nextSlots = [...slots]
  nextSlots[input.slotIndex] = null
  if (child) {
    doc.transaction('storyboard-take-out', (tx) => {
      tx.updateNode(child.id, { parentId: undefined, position: input.position })
      tx.updateNode(input.storyboardId, { data: storyboardPatchWithSlots(nextSlots) })
    })
    return { ok: true, nodeId: child.id }
  }
  if (!input.createImageNode) return { ok: false, reason: '槽位里没有对应的图片节点' }
  const newNodeId = input.createImageNode(slot.resourceId, input.position, {
    ...(slot.name ? { name: slot.name } : {}),
    ...(slot.width ? { width: slot.width } : {}),
    ...(slot.height ? { height: slot.height } : {}),
  })
  if (!newNodeId) return { ok: false, reason: '补建图片节点失败' }
  doc.transaction('storyboard-take-out', (tx) => {
    tx.updateNode(input.storyboardId, { data: storyboardPatchWithSlots(nextSlots) })
  })
  return { ok: true, nodeId: newNodeId }
}

/** 交换两个槽位；两个都空 / 同一个 / 越界 → 不写 store */
export function swapStoryboardSlots(
  doc: StoryboardDocPort,
  input: { storyboardId: string; a: number; b: number },
): { ok: boolean; reason?: string } {
  if (input.a === input.b) return { ok: true }
  const board = doc.getNode(input.storyboardId)
  if (!board || board.type !== STORYBOARD_NODE_TYPE) return { ok: false, reason: '分镜组不存在' }
  const total = typeof board.data.rows === 'number' && typeof board.data.cols === 'number' ? board.data.rows * board.data.cols : 0
  const slots = readStoryboardSlots(board.data.slots, total)
  if (input.a < 0 || input.b < 0 || input.a >= total || input.b >= total) return { ok: false, reason: '槽位越界' }
  if (!slots[input.a] && !slots[input.b]) return { ok: true }
  const next = swapSlots(slots, input.a, input.b)
  // 子节点的位置也要跟着走：否则视觉上槽位图交换了，画布上的子图片还停在原坐标
  const children = doc.getNodes().filter((n) => n.parentId === input.storyboardId && n.type === 'image')
  const geo = geometryOf(board.data)
  const cols = typeof board.data.cols === 'number' ? board.data.cols : 1
  const patches: Array<{ id: string; patch: { position: { x: number; y: number } } }> = []
  for (const index of [input.a, input.b]) {
    const slot = next[index]
    if (!slot) continue
    const child = children.find((c) => c.data.resourceId === slot.resourceId)
    if (child) patches.push({ id: child.id, patch: { position: slotLocalPosition(index, cols, geo) } })
  }
  doc.transaction('storyboard-swap', (tx) => {
    tx.updateNode(input.storyboardId, { data: storyboardPatchWithSlots(next) })
    for (const p of patches) tx.updateNode(p.id, p.patch)
  })
  return { ok: true }
}

/** 图片节点是否还能放进某个槽（供拖拽悬停高亮判断；不写数据） */
export function canDropImageIntoSlot(doc: Pick<StoryboardDocPort, 'getNode'>, storyboardId: string, imageNodeId: string, slotIndex: number): boolean {
  const board = doc.getNode(storyboardId)
  const image = doc.getNode(imageNodeId)
  if (!board || board.type !== STORYBOARD_NODE_TYPE || !image || image.type !== 'image') return false
  if (image.parentId && image.parentId !== storyboardId) return false
  const total = typeof board.data.rows === 'number' && typeof board.data.cols === 'number' ? board.data.rows * board.data.cols : 0
  if (slotIndex < 0 || slotIndex >= total) return false
  return !readStoryboardSlots(board.data.slots, total)[slotIndex]
}

/** 只读：槽位里某张图的显示尺寸（用于空态 / 占位比例，不加载图片） */
export function slotAspect(slot: StoryboardSlot | null): number {
  const w = slot?.width ?? 0
  const h = slot?.height ?? 0
  return w > 0 && h > 0 ? w / h : 4 / 3
}

/** 从 doc 上取分镜组的形状（测试/诊断；组件直接用 doc） */
export function storyboardOf(doc: Pick<DocService, 'getNode'>, id: string): { id: string; data: Record<string, unknown> } | null {
  const node = doc.getNode(id)
  return node && node.type === STORYBOARD_NODE_TYPE ? { id: node.id, data: node.data } : null
}
