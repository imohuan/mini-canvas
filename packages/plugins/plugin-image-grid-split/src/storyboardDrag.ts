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
  decideSnap, normalizeSlots, readStoryboard, readStoryboardLayout, removeFromSlots, slotRects,
  slotIndexByOverlapOrCenter, placeDetachedFromBoard, type SlotRect, type SnapBoard,
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
 * 画布上所有可用分镜组（几何 + 行列 + 槽位表）。
 *
 * 提取成独立函数：拖拽落地与「是否该提示」必须用**同一套**几何，
 * 两份各算一遍迟早会分叉（一个说相交、另一个说没相交）。
 */
function collectBoards(doc: DocPort, layout: LayoutPort | undefined): SnapBoard[] {
  return doc.getNodes()
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
    .filter((b): b is SnapBoard => b !== null)
}

/**
 * 清掉槽位表里"不属于本分镜组"的登记。
 *
 * 用户实测 2026-10-31：普通分组里的图片 285 被写进了分镜组的 slots，
 * 而它的 parentId 指向分组 —— 槽位表说有图，画面上却只有底下那张渲染图，
 * 于是同一个格子里看着像两张图。归属只认一个：**parentId 必须指向本分镜组**。
 *
 * @returns 清洗后的槽位表；本来就干净时返回原引用
 */
function pruneForeignSlots(
  doc: DocPort,
  boardId: string,
  slots: Array<string | null>,
  /** 本次正在拖进来的节点：它还没写完 parentId，不能按旧归属清掉 */
  keepId?: string,
): Array<string | null> {
  let changed = false
  const out = slots.map((id) => {
    if (typeof id !== 'string' || id === '') return null
    if (keepId && id === keepId) return id
    const owner = doc.getNode(id)?.parentId
    if (owner === boardId) return id
    changed = true
    return null
  })
  return changed ? out : slots
}

/**
 * 这次拖拽落点是否真的压在某个分镜组上（只做判定，不改数据）。
 *
 * 用户口径 2026-10-31：拖视频/文字到画布空白处不该弹「分镜组只收图片节点」——
 * 那句提示只有在**与分镜组内部交叉**时才有意义。
 * 判定与 applyStoryboardDrop 完全同源（同一个 decideSnap），不会出现
 * 「提示说相交、实际没吸」或反过来的割裂。
 *
 * @returns 命中的分镜组与目标槽位；没压在组上（或在组外松手）返回 null
 */
export function storyboardHitAt(
  ctx: Context,
  payload: { nodeId: string; position: { x: number; y: number } },
): { boardId: string; slotIndex: number } | null {
  const doc = ctx.tryGet<DocPort | undefined>('doc')
  if (!doc) return null
  const node = doc.getNode(payload.nodeId)
  if (!node) return null
  // 分镜组自己拖着走不算「拖进分镜组」
  if (node.type === 'storyboard') return null
  const layout = ctx.tryGet<LayoutPort | undefined>('nodeLayout')
  const boards = collectBoards(doc, layout)
  if (boards.length === 0) return null
  const currentBoardId = node.parentId && boards.some((b) => b.id === node.parentId) ? node.parentId : null
  const dragRect = { x: payload.position.x, y: payload.position.y, w: node.size?.w ?? 0, h: node.size?.h ?? 0 }
  const decision = decideSnap({
    nodeId: node.id,
    center: { x: payload.position.x, y: payload.position.y },
    currentBoardId,
    boards,
    layout: readStoryboardLayout(ctx),
    dragRect,
  })
  if (decision.kind !== 'snap') return null
  return { boardId: decision.boardId, slotIndex: decision.slotIndex }
}

/**
 * 处理一次拖拽结束。
 * @returns 是否真的动了数据（调用方据此决定要不要提示）
 */
export function applyStoryboardDrop(
  ctx: Context,
  payload: { nodeId: string; position: { x: number; y: number } },
): boolean {
  /** 本次被顶掉、需要我们帮忙选中的节点（用户口径 2026-10-31） */
  let displacedForSelection: string | null = null
  const handled = dropInto(ctx, payload, (id) => { displacedForSelection = id })
  /**
   * 被挤出的图默认会落在分镜组卡片下面（卡片 z 更低、图在卡片内层），
   * 用户"根本看不到它"。所以挤出后**把它设为当前选中**：
   * 选中节点会被抬到选中层并画高亮描边，一眼就能捡回来。
   * 拖进来的那张不抢选中——用户的手还在原位，抢走反而像是"操作失败"。
   *
   * 选中走内核 selection（单源），渲染层会跟着重灌出高亮，不是只改一次 DOM。
   */
  if (handled && displacedForSelection) {
    const id = displacedForSelection
    ctx.tryGet<{ set(ids: Iterable<string>): void } | undefined>('selection')?.set([id])
    ensureNodeVisible(ctx, id)
  }
  return handled
}

/**
 * 把被挤出的节点"摆到看得见的地方"（用户口径 2026-10-31）。
 *
 * 只选中还不够：它经常正好落在分镜组卡片范围内，或是被用户当前的面板/视口边缘压住，
 * 用户仍然找不到它。这里**保持缩放不变**，只平移视口，让这个节点整块进到可视区内；
 * 已经完全可见时什么都不做，避免无意义地晃一下画布。
 */
function ensureNodeVisible(ctx: Context, nodeId: string): void {
  const viewport = ctx.tryGet<{
    getViewport?(): { x: number; y: number; zoom: number }
    setViewport?(v: { x: number; y: number; zoom: number }): void
    animateViewport?(v: { x: number; y: number; zoom: number }, durationMs?: number): void
    getRootEl?(): HTMLElement | null
  } | undefined>('viewport')
  const layout = ctx.tryGet<LayoutPort | undefined>('nodeLayout')
  if (!viewport?.getViewport || !viewport.setViewport) return
  const rect = layout?.getNodeRect(nodeId)
  if (!rect || rect.w <= 0 || rect.h <= 0) return
  const vp = viewport.getViewport()
  if (!Number.isFinite(vp.zoom) || vp.zoom <= 0) return
  const root = viewport.getRootEl?.()
  const vw = root?.clientWidth ?? 0
  const vh = root?.clientHeight ?? 0
  if (vw <= 0 || vh <= 0) return

  /** 屏幕坐标（与 toast / 侧栏重叠区无关，只保证"在画布可视区内"） */
  const margin = 24
  const left = rect.x * vp.zoom + vp.x
  const top = rect.y * vp.zoom + vp.y
  const right = left + rect.w * vp.zoom
  const bottom = top + rect.h * vp.zoom
  let dx = 0
  let dy = 0
  if (left < margin) dx = margin - left
  else if (right > vw - margin) dx = vw - margin - right
  if (top < margin) dy = margin - top
  else if (bottom > vh - margin) dy = vh - margin - bottom
  if (dx === 0 && dy === 0) return

  const next = { x: Math.round(vp.x + dx), y: Math.round(vp.y + dy), zoom: vp.zoom }
  if (viewport.animateViewport) viewport.animateViewport(next)
  else viewport.setViewport(next)
}

function dropInto(
  ctx: Context,
  payload: { nodeId: string; position: { x: number; y: number } },
  /** 通知调用方"这张图被顶掉了"，好让外层决定高亮/选中 */
  onDisplaced: (nodeId: string) => void,
): boolean {
  const doc = ctx.tryGet<DocPort | undefined>('doc')
  if (!doc) return false
  const layout = ctx.tryGet<LayoutPort | undefined>('nodeLayout')
  const slotLayout = readStoryboardLayout(ctx)
  const node = doc.getNode(payload.nodeId)
  if (!node) return false
  // 分镜组自己不参与（拖动分镜组时不该把自己吸进去）
  if (node.type === 'storyboard') return false

  const boards = collectBoards(doc, layout)

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

  /**
   * 槽位唯一性（用户口径 2026-10-30：一个槽位禁止拖进多张图）。
   *
   * 写之前先归一槽位表：重复 id 只留第一处、指向已删节点的槽清空。
   * 这样即便历史数据已经被弄脏（旧版松手不回位导致两图叠一格），
   * 用户下一次拖动的落库就把整张表修干净 —— 不需要单独的修复脚本。
   */
  /**
   * 槽位表现在只登记**本分镜组的直接子节点**（用户实测 2026-10-31）。
   * 先把不属于本组的登记清出去，再让「一槽一图」只针对真正的成员生效 ——
   * 否则分组里的图 285 会被当成组内住户，和拖进来的图叠在同一格。
   */
  const slots = pruneForeignSlots(
    doc,
    board.id,
    normalizeSlots(decision.slots, (id) => Boolean(doc.getNode(id))),
    node.id,
  )

  /**
   * 组内每个槽位只允许一个节点（用户口径 2026-10-31：外部拖进来仍会两张叠一格）。
   *
   * slots 是"谁占哪格"的唯一真相，但**光看它不够**：外部拖进来时宿主可能已经给节点
   * 写了 parentId，而 slots 里还没有它 —— 于是两张图挂在同一格，用户看到的就是重叠。
   * 这里以 slots 为准逐个清点组内子节点：不在 slots 里的一律解父成自由节点。
   * 它们本来就不是这个组的成员，留在组里只会继续叠着别人。
   */
  const evict = new Set<string>()
  for (const child of doc.getNodes()) {
    if (child.id === node.id || child.parentId !== board.id) continue
    if (child.type !== 'image') continue
    if (!slots.includes(child.id)) evict.add(child.id)
  }
  for (const id of evict) {
    const other = doc.getNode(id)
    if (!other) continue
    detachLayout = layout
    /**
     * 这次被顶掉的那张图走"原地错开"，不参与"找组外空位"。
     * 顺序上这里先跑（slots 已经不含它），如果在这里按旧逻辑甩到组外，
     * 后面 displaced 分支就找不到父级、判断不成立，用户看到的就是"跳到右上角"。
     */
    if (id === decision.displacedNodeId) {
      const abs = layout?.absolutePosition?.(other.id)
        ?? { x: board.x + (other.position?.x ?? 0), y: board.y + (other.position?.y ?? 0) }
      detachFromBoard(doc, other, board.id, {
        x: Math.round(abs.x + DISPLACED_OFFSET),
        y: Math.round(abs.y + DISPLACED_OFFSET),
      })
      onDisplaced(other.id)
      continue
    }
    // 挪到分镜组外面：只解父、位置不动的话它会继续趴在某个槽位上，
    // 和新拖进来的图叠在一起（用户实测 2026-10-31「一槽两图」）。
    const prevOther = other.data?._storyboardSize as { w: number; h: number } | undefined
    const otherSize = prevOther && prevOther.w > 0 && prevOther.h > 0
      ? prevOther
      : { w: other.size?.w ?? 320, h: other.size?.h ?? 240 }
    const outside = placeDetachedFromBoard({
      ctx,
      board,
      size: otherSize,
      nodeId: other.id,
      excludeIds: [node.id],
    })
    detachFromBoard(doc, other, board.id, outside)
  }

  const fitted = fitInsideSlot({ w: slot.w, h: slot.h }, aspectOf(node), fitImageLimits(ctx))
  const inside = centerInsideSlot({ w: slot.w, h: slot.h }, fitted)
  // 记下进组前的尺寸，脱离时还原（只在第一次进组时记，避免被槽位尺寸覆盖）
  const prevSize = node.data?._storyboardSize as { w: number; h: number } | undefined
  const restore = prevSize && prevSize.w > 0 && prevSize.h > 0
    ? prevSize
    // 之前挂在**普通分组**里时，node.size 是分组内的显示尺寸；脱离时还要还原成它，
    // 所以这里要把当前尺寸记下来（否则出组后图片会变成槽位尺寸）。
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
  doc.updateNode(board.id, { data: { slots } })
  doc.updateNode(node.id, patch)

  // 被顶换位的节点：挪到移动节点原来的格（decideSnap 已把 slots 排好），位置也跟过去
  const displaced = decision.displacedNodeId
  if (displaced && displaced !== node.id) {
    const other = doc.getNode(displaced)
    const newIndex = slots.indexOf(displaced)
    const target = newIndex >= 0 ? rects[newIndex] : undefined
    /**
     * 被“顶掉”的节点必须真的是本分镜组的成员。
     *
     * 用户实测 2026-10-31：槽位表里混进过普通分组的图片，它被判成“原住户”后，
     * 这里直接解父/挪位，把别人分组里的节点拆了出来。归属不成立的，一律不碰。
     */
    const belongs = Boolean(other && other.parentId === board.id)
    if (other && belongs && target) {
      // 常规换位：被顶的节点挪到移动节点原来的格
      const f2 = fitInsideSlot({ w: target.w, h: target.h }, aspectOf(other), fitImageLimits(ctx))
      const c2 = centerInsideSlot({ w: target.w, h: target.h }, f2)
      doc.updateNode(displaced, {
        parentId: board.id,
        position: { x: target.x + c2.dx, y: target.y + c2.dy },
        size: { w: f2.w, h: f2.h },
        data: { _storyboardSlot: newIndex },
      })
    } else if (other && belongs && decision.displaceDetach) {
      /**
       * 兜底：正常情况下被顶掉的节点在上面的 evict 循环里就已经"原地错开"处理完，
       * 走到这里说明它没有出现在组内子节点清单里（数据边界）。
       * 仍按同一规则放下，保证任何路径都不会甩到组外远处。
       */
      detachLayout = layout
      const otherAbs = layout?.absolutePosition?.(other.id)
        ?? { x: board.x + (other.position?.x ?? 0), y: board.y + (other.position?.y ?? 0) }
      detachFromBoard(doc, other, board.id, {
        x: Math.round(otherAbs.x + DISPLACED_OFFSET),
        y: Math.round(otherAbs.y + DISPLACED_OFFSET),
      })
      onDisplaced(other.id)
    }
  }
  return true
}

/** 被顶掉的节点相对原槽位的右下偏移量（px，用户口径 2026-10-31） */
const DISPLACED_OFFSET = 20

let detachLayout: LayoutPort | undefined

/** 当前被标成半透明的节点 id（松手/移出时清掉；跨事件共享） */
let lastMarked = ''
/** 已经打过半透明属性的节点（松手时统一清，防多选/漏事件残留） */
const ghosted = new Set<string>()

/**
 * 拖动时让**整张卡片**真正透明（用户口径 2026-10-30：之前只是图片颜色变淡，
 * 卡片底色/边框仍然不透明，所以看起来不像"透过去"）。
 *
 * 做法：给节点 DOM 外壳打一个属性，再由本插件注入的一条 CSS 把它整层降到 0.45。
 * 为什么不在图片组件里调 opacity：那只让 <img> 变淡，卡片表面（--card-surface）
 * 仍然盖在底下 —— 用户看到的就是"颜色变淡"而不是"看见下面"。
 * 打在节点外壳上则连底色、边框、标题一起透，视觉上才是真的半透明。
 *
 * 样式只注入一次（按 id 判重），插件卸载时由 ctx.effect 移除。
 */
const GHOST_ATTR = 'data-sb-dragging'
const GHOST_STYLE_ID = 'image-grid-split-ghost-style'

function ensureGhostStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(GHOST_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = GHOST_STYLE_ID
  el.textContent =
    // 整张卡片（含底色/边框/标题）一起降到 45%：这才是"透过去看得见下面"的观感。
    // 只调 <img> 的 opacity 只会让画面变淡，卡片表面仍然不透明（用户实测截图）。
    // 只改 opacity，**不动 pointer-events**：拖动本身要靠节点接指针事件，
    // 关掉会把手势打断（边拖边失去拖拽）。半透明已经足够看见底下的槽位。
    '.vue-flow__node[' + GHOST_ATTR + ']{opacity:.45;transition:opacity 120ms ease;}'
  document.head.appendChild(el)
}

function removeGhostStyle(): void {
  if (typeof document === 'undefined') return
  document.getElementById(GHOST_STYLE_ID)?.remove()
}

/** 打开/关闭某节点的拖动半透明（DOM 外壳级；拿不到元素就静默跳过） */
function setGhost(ctx: Context, nodeId: string, on: boolean): void {
  const vp = ctx.tryGet<{ queryNodeEl?(id: string): HTMLElement | null } | undefined>('viewport')
  const el = vp?.queryNodeEl?.(nodeId)
  if (!el) return
  if (on) el.setAttribute(GHOST_ATTR, '')
  else el.removeAttribute(GHOST_ATTR)
}

/**
 * 清掉本轮所有半透明标记（松手 / 拖到组外 / 换了拖动对象都要清）。
 *
 * 只动 DOM 属性，不写 doc：见 onStoryboardDragEnd 里的长注释 —— 拖拽中的视觉状态
 * 一旦写进作品数据，就会把「相对坐标 + 旧父级」的中间态一起存进画布。
 */
function releaseGhosts(ctx: Context): void {
  for (const id of ghosted) setGhost(ctx, id, false)
  ghosted.clear()
  lastMarked = ''
  // 兜底扫一遍 DOM：热更新 / 插件重载会把模块级 ghosted 清空，
  // 但属性留在元素上 → 用户看到"拖完还是半透明"，且之后没有任何代码记得清它。
  // 按属性扫全表是唯一不依赖内存状态的清法。
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll('.vue-flow__node[' + GHOST_ATTR + ']')) {
      el.removeAttribute(GHOST_ATTR)
    }
  }
}

/**
 * 松手后的**延迟兜底清理**（用户口径 2026-10-31）。
 *
 * 为什么光靠事件不够：拖拽结束这一步会被很多边缘情况打断 ——
 * 松手落在 iframe/画布外、浏览器失焦、宿主重挂载渲染态、热更新换了模块实例……
 * 任何一种都会让 drag-end 没跑到（或跑到的不是同一份 ghosted），属性就留在 DOM 上，
 * 用户看到一张永远 45% 透明的卡片，只能刷新才好。
 *
 * 所以除了即时清理，再在松手后多扫几次（60ms / 200ms / 600ms）：
 * 只按 DOM 属性扫，不依赖任何内存状态，扫到就抹掉。多次是为了避开
 * 「松手瞬间宿主还在重灌渲染态、清完又被贴回去」的窗口。
 */
const sweepTimers: Array<ReturnType<typeof setTimeout>> = []
function scheduleGhostSweep(ctx: Context, delays: number[] = [60, 200, 600]): void {
  for (const t of sweepTimers) clearTimeout(t)
  sweepTimers.length = 0
  for (const delay of delays) {
    sweepTimers.push(setTimeout(() => releaseGhosts(ctx), delay))
  }
}

/**
 * 全局「指针抬起 / 窗口失焦」兜底（用户口径 2026-10-31：边缘情况下透明度清不掉）。
 *
 * 为什么不能只挂在 drag-end 上：那个事件由宿主在拖拽结束时发，一旦这次手势被
 * 打断（松手落在画布外、模式中途退出、渲染态重灌…）它就不来了，属性永远留在 DOM 上。
 * 指针抬起是**浏览器级**事件，只要用户松了手就一定有；拿它兜底最可靠。
 * 主动时不做判断、直接扫属性抹掉 —— 半透明只可能是拖拽中的临时态，松手后就不该存在。
 */
let globalSweepBound = false
function bindGlobalGhostSweep(ctx: Context): void {
  if (globalSweepBound || typeof window === 'undefined') return
  globalSweepBound = true
  const onUp = (): void => {
    // 立刻清一次，再补两轮（宿主可能在这之后重灌渲染态把属性贴回来）
    releaseGhosts(ctx)
    scheduleGhostSweep(ctx, [120, 400])
  }
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('mouseup', onUp, true)
  window.addEventListener('blur', onUp, true)
  sweepListeners.push(() => {
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('mouseup', onUp, true)
    window.removeEventListener('blur', onUp, true)
  })
}

/** 全局兜底监听器的解绑函数（插件卸载时执行） */
const sweepListeners: Array<() => void> = []

/** 插件卸载时把还没跑的兜底清单一并取消（否则定时器会在回收后再动 DOM） */
export function disposeGhostSweep(): void {
  for (const t of sweepTimers) clearTimeout(t)
  sweepTimers.length = 0
  for (const off of sweepListeners.splice(0)) off()
  globalSweepBound = false
}

/** 脱离分镜组：清父级、**绝对坐标**、还原尺寸、从 slots 里摘掉。
 *
 * 用户口径 2026-10-30（参考分组节点）：脱离时 store 的 position 还是**相对父**的值，
 * 直接清父级会让节点瞬移（相对值被当成绝对值用）。必须先取"当前真实绝对位置"
 * （nodeLayout.absolutePosition 会沿父链累加），再解父。 */
function detachFromBoard(
  doc: DocPort,
  node: NodeLike,
  boardId: string,
  /** 指定脱离后的绝对位置（不给 = 用节点当前真实绝对位置，即“拖到哪就在哪”） */
  targetAbs?: { x: number; y: number },
): void {
  const layout = detachLayout
  const boardNode = doc.getNode(boardId)
  const board = readStoryboard(boardNode?.data)
  if (boardNode && board) {
    doc.updateNode(boardId, { data: { slots: removeFromSlots(board.slots, node.id) } })
  }
  const prev = node.data?._storyboardSize as { w: number; h: number } | undefined
  // 绝对位置：父链完整累加（分组同款）。nodeLayout 缺席时退回当前值（不猜）
  const detachAbs = targetAbs ?? layout?.absolutePosition?.(node.id)
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
  // 回调要带落地坐标：调用方判断「有没有真的压在分镜组上」得用同一次落点，
  // 只给 nodeId 就只能重新猜一次位置（猜不准就会像以前那样到处弹提示）。
  cb: (handled: boolean, payload: { nodeId: string; position: { x: number; y: number } }) => void,
): { dispose(): void } {
  ensureGhostStyle()
  bindGlobalGhostSweep(ctx)
  return ctx.on(NODE_DRAG_END, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    // 先无论成败都清半透明：applyStoryboardDrop 抛错时若跳过清理，
    // 节点会永远停在 45% 透明（用户实测截图：松手后透明度没恢复）。
    let handled = false
    try {
      handled = applyStoryboardDrop(ctx, payload)
    } finally {
      releaseGhosts(ctx)
      // 再补几轮延迟清理：宿主重灌渲染态 / 事件被打断时，即时那次会被冲掉。
      scheduleGhostSweep(ctx)
      clearHover()
    }
    // 松手必清半透明标记（无论吸附还是脱离）。
    //
    // 只清 DOM 标记，**不写 data**：`_storyboardDragging` 曾经写在 doc.data 里，
    // 而 doc 每次写都会触发整图落盘 —— 拖动逐帧打标就意味着「拖到一半的相对坐标 +
    // 旧 parentId」被当成正式内容存了一版；松手后插件刚把 parentId 清掉，
    // 那版中间态又随下一次保存把父级写回去（浏览器实测 2026-10-31：拖出分镜组后
    // 刷新页面节点又回到组里）。视觉状态本来就不该进作品数据。
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
  ensureGhostStyle()
  return ctx.on(NODE_DRAG, (payload: { nodeId: string; position: { x: number; y: number } }) => {
    if (!doc) return
    const node = doc.getNode(payload.nodeId)
    if (!node || node.type !== 'image') {
      clearHover()
      if (lastMarked) {
        releaseGhosts(ctx)
      }
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
    let hit: { n: NodeLike; rect: { x: number; y: number; w: number; h: number }; board: NonNullable<ReturnType<typeof readStoryboard>> } | null = null
    for (const b of boards) {
      const overlapW = Math.min(dragRect.x + dragRect.w, b.rect.x + b.rect.w) - Math.max(dragRect.x, b.rect.x)
      const overlapH = Math.min(dragRect.y + dragRect.h, b.rect.y + b.rect.h) - Math.max(dragRect.y, b.rect.y)
      if (overlapW > 0 && overlapH > 0) { hit = b; break }
    }
    if (!hit) {
      clearHover()
      if (lastMarked) {
        releaseGhosts(ctx)
      }
      return
    }
    const rects = slotRects(hit.rect.w, hit.rect.h, hit.board.rows, hit.board.cols, readStoryboardLayout(ctx))
    const slotIndex = slotIndexByOverlapOrCenter(rects, { x: hit.rect.x, y: hit.rect.y }, dragRect, payload.position)
    hover.nodeId = payload.nodeId
    hover.boardId = hit.n.id
    hover.slotIndex = slotIndex
    // 拖动节点与分镜组交叉 → 半透明（用户口径 2026-10-30：别把槽位全挡住）
    if (lastMarked !== payload.nodeId) {
      // 整张卡片透明（DOM 外壳级）：只调图片 opacity 只会"颜色变淡"，卡片底色还盖着
      setGhost(ctx, payload.nodeId, true)
      ghosted.add(payload.nodeId)
      lastMarked = payload.nodeId
    }
  })
}
