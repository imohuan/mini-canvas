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
import type { Context } from '@mini-canvas/canvas-base'
import { decideSnap, readStoryboard, removeFromSlots, slotRects, type SlotRect } from './storyboard'

/** 渲染层广播的拖拽结束事件（与 RenderEvents.NodeDragEnd 同值；本地常量避免运行时依赖） */
const NODE_DRAG_END = 'canvas:node:drag-end'

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
): { w: number; h: number } {
  if (!Number.isFinite(aspect) || aspect <= 0) return { w: slot.w, h: slot.h }
  let h = slot.h
  let w = h * aspect
  if (w > slot.w) {
    w = slot.w
    h = w / aspect
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

  const decision = decideSnap({
    nodeId: node.id,
    center: { x: payload.position.x, y: payload.position.y },
    currentBoardId,
    boards,
  })

  if (decision.kind === 'none') return false

  if (decision.kind === 'detach') {
    detachFromBoard(doc, node, currentBoardId!)
    return true
  }

  // 非图片拖进槽位：不吸附，保持原样（提示由调用方给）
  if (!isImage) {
    if (currentBoardId) detachFromBoard(doc, node, currentBoardId)
    return false
  }

  const board = boards.find((b) => b.id === decision.boardId)
  if (!board) return false
  const rects = slotRects(board.w, board.h, board.rows, board.cols)
  const slot = rects[decision.slotIndex]
  if (!slot) return false

  const fitted = fitInsideSlot({ w: slot.w, h: slot.h }, aspectOf(node))
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
        const f2 = fitInsideSlot({ w: target.w, h: target.h }, aspectOf(other))
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

/** 脱离分镜组：清父级、还原尺寸、从 slots 里摘掉、位置改成绝对坐标 */
function detachFromBoard(doc: DocPort, node: NodeLike, boardId: string): void {
  const boardNode = doc.getNode(boardId)
  const board = readStoryboard(boardNode?.data)
  if (boardNode && board) {
    doc.updateNode(boardId, { data: { slots: removeFromSlots(board.slots, node.id) } })
  }
  const prev = node.data?._storyboardSize as { w: number; h: number } | undefined
  doc.updateNode(node.id, {
    parentId: undefined,
    position: node.position ?? { x: 0, y: 0 },
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
    cb(handled, payload)
  })
}
