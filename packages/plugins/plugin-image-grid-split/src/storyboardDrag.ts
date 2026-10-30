/**
 * storyboardDrag —— 分镜组的拖拽归属（把拖拽结束翻译成"进槽 / 换位 / 脱离"）。
 *
 * 为什么单独一层：和 plugin-group 的 applyDragMembership 同一位置、同一时机，
 * 但规则不同 —— 组是"进范围就挂父级"，分镜组还要**对齐到最近的槽位并锁定尺寸**。
 * 纯逻辑（decideSnap）已经单测；这里只做 ctx ↔ 服务的编排，方便替换/复核。
 *
 * 三条边界（用户口径 2026-10-30）：
 *  - **只收图片节点**：别的类型拖进来一律不动，给一句提示；
 *  - 图片保持自己的宽高比，在槽位里**容器式预览**（高度铺满、左右居中）；
 *  - 拖出卡片就是自由节点，尺寸还原成进组前的值（存在 data._storyboardSize 里）。
 */
import { reactive } from 'vue'
import type { Context } from '@mini-canvas/canvas-base'
import {
  decideSnap, readStoryboard, readStoryboardLayout, removeFromSlots, slotRects,
  slotIndexByOverlapOrCenter, type SlotRect,
} from './storyboard'
import { fitImageLimits } from './imageFitBridge'

/** 渲染层广播的拖拽结束事件（与 RenderEvents.NodeDragEnd 同值；本地常量避免运行时依赖） */
const NODE_DRAG_END = 'canvas:node:drag-end'
/** 拖动逐帧事件（RenderEvents.NodeDrag 同名；悬停高亮用） */
const NODE_DRAG = 'canvas:node:drag'

/** 节点最小形状（doc 读口） */
interface NodeLike {
  id: string
  type?: string
  parentId?: string
  position?: { x: number; y: number }
  size?: { w: number; h: number }
  data?: Record<string, unknown>
}

interface DocPort {
  getNode(id: string): NodeLike | undefined
  getNodes(): NodeLike[]
  updateNode(id: string, patch: Record<string, unknown>): unknown
  updateNodes?(entries: Array<{ id: string; patch: Record<string, unknown> }>): unknown
}

interface LayoutPort {
  getNodeRect(id: string): { x: number; y: number; w: number; h: number } | null | undefined
  absolutePosition?(id: string): { x: number; y: number }
}

/** 悬停高亮状态（模块级：一次只拖一个节点；组件读同一份） */
interface HoverState {
  /** 被拖节点 id */
  nodeId: string
  /** 获胜槽位（-1 = 无） */
  slotIndex: number
  /** 获胜分镜组 id */
  boardId: string
}
/** 分镜组底板（StoryboardGrid.vue）订阅这份状态做高亮 */
const hover = reactive<HoverState>({ nodeId: '', slotIndex: -1, boardId: '' })

/** 组件读当前悬停（只读） */
export function storyboardHover(): Readonly<HoverState> {
  return hover
}

/** 清悬停（拖出/松手后调用） */
function clearHover(): void {
  hover.nodeId = ''
  hover.slotIndex = -1
  hover.boardId = ''
}

/** 分镜组节点在画布上的矩形（绝对坐标） */
function boardRectOf(layout: LayoutPort | undefined, node: NodeLike): { x: number; y: number; w: number; h: number } {
  const measured = layout?.getNodeRect(node.id)
  if (measured && measured.w > 0 && measured.h > 0) return measured
  return {
    x: node.position?.x ?? 0,
    y: node.position?.y ?? 0,
    w: node.size?.w ?? 480,
    h: node.size?.h ?? 360,
  }
}

/** 把「槽位矩形（相对分镜组）」换算成子节点应写的位置（相对父） */
function slotLocalPosition(rect: SlotRect): { x: number; y: number } {
  return { x: Math.round(rect.x), y: Math.round(rect.y) }
}

/**
 * 容器式预览的尺寸：图片按槽位**高度**铺满，宽度按图片自身比例算，并夹在槽位宽度内。
 * 用户口径 2026-10-30：「高度对齐，左右居中」—— 竖图不被拉伸，宽图不溢出。
 */
export function fitInsideSlot(
  slot: { w: number; h: number },
  aspect: number,
  limits?: { minShortSide: number; maxLongSide: number } | null,
): { w: number; h: number } {
  if (!Number.isFinite(aspect) || aspect <= 0) return { w: slot.w, h: slot.h }
  let h = slot.h
  let w = h * aspect
  if (w > slot.w) {
    w = slot.w
    h = w / aspect
  }
  // 图片节点自己的「最短边最小」约束（用户口径 2026-10-30：发送/吸附都要按这条规则求证）。
  // 槽位放不下最短边时**槽位赢**（缩小到槽位为止），否则按最短边撑开。
  const minShort = limits && Number.isFinite(limits.minShortSide) && limits.minShortSide > 0 ? limits.minShortSide : null
  if (minShort !== null) {
    const short = Math.min(w, h)
    if (short < minShort && Math.max(w, h) <= Math.max(slot.w, slot.h)) {
      // 等比放大到最短边，只要长边不超出槽位即可
      const k = minShort / short
      const w2 = Math.round(w * k)
      const h2 = Math.round(h * k)
      if (w2 <= slot.w && h2 <= slot.h) { w = w2; h = h2 }
    }
  }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }
}

/** 槽位里居中：返回相对槽位的偏移 */
export function centerInsideSlot(
  slot: { w: number; h: number },
  content: { w: number; h: number },
): { dx: number; dy: number } {
  return { dx: Math.round((slot.w - content.w) / 2), dy: Math.round((slot.h - content.h) / 2) }
}

/** 图片节点的宽高比（先看 data 里的原图尺寸，再看节点尺寸，最后 4:3） */
function aspectOf(node: NodeLike): number {
  const d = node.data ?? {}
  const iw = typeof d.imageWidth === 'number' ? d.imageWidth : 0
  const ih = typeof d.imageHeight === 'number' ? d.imageHeight : 0
  if (iw > 0 && ih > 0) return iw / ih
  const w = node.size?.w ?? 0
  const h = node.size?.h ?? 0
  if (w > 0 && h > 0) return w / h
  return 4 / 3
}

/**
 * 处理一次拖拽结束。
 * @returns 是否真的动了数据（调用方据此决定要不要提示）
 */
export function applyStoryboardDrop(
  ctx: Context,
  payload: { nodeId: string; position: { x: number; y: number } },
): boolean {
  const doc = ctx.tryGet<DocPort | undefined>('doc')
  if (!doc) return false
  const layout = ctx.tryGet<LayoutPort | undefined>('nodeLayout')
  const slotLayout = readStoryboardLayout(ctx)
  const node = doc.getNode(payload.nodeId)
  if (!node) return false
  // 分镜组自己不参与（拖动分镜组时不该把自己吸进去）
  if (node.type === 'storyboard') return false

  const boards = doc.getNodes()
    .filter((n) => n.type === 'storyboard')
    .map((n) => {
      const rect = boardRectOf(layout, n)
      const board = readStoryboard(n.data)
      if (!board) return null
      return {
        id: n.id,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        rows: board.rows,
        cols: board.cols,
        slots: board.slots,
      }
    })
    .filter((b): b is NonNullable<typeof b> => b !== null)

  const currentBoardId = node.parentId && boards.some((b) => b.id === node.parentId) ? node.parentId : null
  // 只有图片能进槽位（用户口径：只允许图片节点）
  const isImage = node.type === 'image'

  /**
   * 目标槽判定：**交叉面积最大者获胜**（用户口径 2026-10-30）。
   * 拖动矩形 = NodeDrag/NodeDragEnd 事件给的左上角 + 节点尺寸；缺尺寸退化中心点。
   */
  const dragRect = { x: payload.position.x, y: payload.position.y, w: node.size?.w ?? 0, h: node.size?.h ?? 0 }
  const decision = decideSnap({
    nodeId: node.id,
    center: { x: payload.position.x, y: payload.position.y },
    currentBoardId,
    boards,
    layout: slotLayout,
    dragRect,
  })

  if (decision.kind === 'none') return false

  if (decision.kind === 'detach') {
    detachLayout = layout
    detachFromBoard(doc, node, currentBoardId!)
    return true
  }

  // 非图片拖进槽位：不吸附，保持原样（提示由调用方给）
  if (!isImage) {
    detachLayout = layout
    if (currentBoardId) detachFromBoard(doc, node, currentBoardId)
    return false
  }

  const board = boards.find((b) => b.id === decision.boardId)
  if (!board) return false
  const rects = slotRects(board.w, board.h, board.rows, board.cols, slotLayout)
  const slot = rects[decision.slotIndex]
  if (!slot) return false

  const fitted = fitInsideSlot({ w: slot.w, h: slot.h }, aspectOf(node), fitImageLimits(ctx))
  const inside = centerInsideSlot({ w: slot.w, h: slot.h }, fitted)
  // 记下进组前的尺寸，脱离时还原（只在第一次进组时记，避免被槽位尺寸覆盖）
  const prevSize = node.data?._storyboardSize as { w: number; h: number } | undefined
  const restore = prevSize && prevSize.w > 0 && prevSize.h > 0
    ? prevSize
    : { w: node.size?.w ?? 320, h: node.size?.h ?? 240 }

  const patch = {
    parentId: board.id,
    position: {
      x: slotLocalPosition(slot).x + inside.dx,
      y: slotLocalPosition(slot).y + inside.dy,
    },
    size: { w: fitted.w, h: fitted.h },
    data: { _storyboardSize: restore, _storyboardSlot: decision.slotIndex },
  }

  // 分镜组的 slots 与被顶下来的节点要一起写：一次事务里全写完，撤销才是一步
  const boardNode = doc.getNode(board.id)
  if (!boardNode) return false
  doc.updateNode(board.id, { data: { slots: decision.slots } })
  doc.updateNode(node.id, patch)

  // 被顶换位的节点：挪到移动节点原来的格（decideSnap 已把 slots 排好），位置也跟过去
  const displaced = decision.displacedNodeId
  if (displaced && displaced !== node.id) {
    const newIndex = decision.slots.indexOf(displaced)
    const target = rects[newIndex]
    if (target) {
      const other = doc.getNode(displaced)
      if (other) {
        const f2 = fitInsideSlot({ w: target.w, h: target.h }, aspectOf(other), fitImageLimits(ctx))
        const c2 = centerInsideSlot({ w: target.w, h: target.h }, f2)
        doc.updateNode(displaced, {
          parentId: board.id,
          position: { x: target.x + c2.dx, y: target.y + c2.dy },
          size: { w: f2.w, h: f2.h },
          data: { _storyboardSlot: newIndex },
        })
      }
    }
  }
  return true
}

let detachLayout: LayoutPort | undefined

/** 脱离分镜组：清父级、**绝对坐标**、还原尺寸、从 slots 里摘掉。
 *
 * 用户口径 2026-10-30（参考分组节点）：脱离时 store 的 position 还是**相对父**的值，
 * 直接清父级会让节点瞬移（相对值被当成绝对值用）。必须先取"当前真实绝对位置"
 * （nodeLayout.absolutePosition 会沿父链累加），再解父。 */
function detachFromBoard(doc: DocPort, node: NodeLike, boardId: string): void {
  const layout = detachLayout
  const boardNode = doc.getNode(boardId)
  const board = readStoryboard(boardNode?.data)
  if (boardNode && board) {
    doc.updateNode(boardId, { data: { slots: removeFromSlots(board.slots, node.id) } })
  }
  const prev = node.data?._storyboardSize as { w: number; h: number } | undefined
  // 绝对位置：父链完整累加（分组同款）。nodeLayout 缺席时退回当前值（不猜）
  const detachAbs = layout?.absolutePosition?.(node.id)
  doc.updateNode(node.id, {
    parentId: undefined,
    position: detachAbs ?? node.position ?? { x: 0, y: 0 },
    size: prev && prev.w > 0 && prev.h > 0 ? prev : node.size,
    data: { _storyboardSlot: undefined, _storyboardSize: undefined },
  })
}

/** 订阅拖拽结束（插件卸载时自动退订由调用方包 ctx.effect） */
export function onStoryboardDragEnd(
  ctx: Context,
  cb: (handled: boolean, payload: { nodeId: string }) => void,
): { dispose(): void } {
  return ctx.on(NODE_DRAG_END, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    const handled = applyStoryboardDrop(ctx, payload)
    // 松手必清半透明标记（无论吸附还是脱离）
    ctx.tryGet<DocPort | undefined>('doc')?.updateNode(payload.nodeId, { data: { _storyboardDragging: undefined } })
    lastMarked = ''
    clearHover()
    cb(handled, payload)
  })
}

/**
 * 拖动逐帧：算"交叉面积最大"的获胜槽位 → 写进 hover 状态（底板组件读它做高亮）。
 * 同时给**被拖节点加半透明**（用户口径：图片盖住槽位时至少能看到底下槽位在哪）。
 */
export function onStoryboardDragMove(ctx: Context): { dispose(): void } {
  const doc = ctx.tryGet<DocPort | undefined>('doc')
  const layout = ctx.tryGet<LayoutPort | undefined>('nodeLayout')
  /** 上一帧标了半透明的节点（本帧不在组上时要清掉） */
  let lastMarked = ''
  return ctx.on(NODE_DRAG, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    if (!doc) return
    const node = doc.getNode(payload.nodeId)
    if (!node || node.type !== 'image') {
      clearHover()
      if (lastMarked) { doc.updateNode(lastMarked, { data: { _storyboardDragging: undefined } }); lastMarked = '' }
      return
    }
    const boards = doc.getNodes()
      .filter((n) => n.type === 'storyboard')
      .map((n) => ({ n, rect: boardRectOf(layout, n), board: readStoryboard(n.data) }))
      .filter((x): x is { n: NodeLike; rect: { x: number; y: number; w: number; h: number }; board: NonNullable<ReturnType<typeof readStoryboard>> } => x.board !== null)
    // 命中卡片：矩形交叉（大图滑过时"盖住最多"的槽获胜）
    const dragRect = {
      x: payload.position.x,
      y: payload.position.y,
      w: node.size?.w ?? 0,
      h: node.size?.h ?? 0,
    }
    let hit: { id: string; rect: { x: number; y: number; w: number; h: number }; board: NonNullable<ReturnType<typeof readStoryboard>> } | null = null
    for (const b of boards) {
      const overlapW = Math.min(dragRect.x + dragRect.w, b.rect.x + b.rect.w) - Math.max(dragRect.x, b.rect.x)
      const overlapH = Math.min(dragRect.y + dragRect.h, b.rect.y + b.rect.h) - Math.max(dragRect.y, b.rect.y)
      if (overlapW > 0 && overlapH > 0) { hit = b; break }
    }
    if (!hit) {
      clearHover()
      if (lastMarked) { doc.updateNode(lastMarked, { data: { _storyboardDragging: undefined } }); lastMarked = '' }
      return
    }
    const rects = slotRects(hit.rect.w, hit.rect.h, hit.board.rows, hit.board.cols, readStoryboardLayout(ctx))
    const slotIndex = slotIndexByOverlapOrCenter(rects, { x: hit.rect.x, y: hit.rect.y }, dragRect, payload.position)
    hover.nodeId = payload.nodeId
    hover.boardId = hit.n.id
    hover.slotIndex = slotIndex
    // 拖动节点与分镜组交叉 → 半透明（用户口径 2026-10-30：别把槽位全挡住）
    if (lastMarked !== payload.nodeId) {
      doc.updateNode(payload.nodeId, { data: { _storyboardDragging: true } })
      lastMarked = payload.nodeId
    }
  })
}
