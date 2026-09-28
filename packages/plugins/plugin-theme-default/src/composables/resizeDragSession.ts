/**
 * resizeDragSession —— 卡片 resize 的拖拽会话（纯逻辑、零 Vue、零 DOM，Node 可单测）。
 *
 * ## 为什么单独抽出来（线上 bug 修复）
 * 原实现把 pointermove / pointerup **绑在 resize 手柄元素自己身上**，靠 setPointerCapture 把
 * 后续事件"钉"回该元素。但捕获并不总是成立（实测 handle.setPointerCapture 被调用后
 * hasPointerCapture 仍为 false，且元素一旦被重建捕获即失效）——捕获没生效时，鼠标一离开手柄
 * 元素就收不到 pointermove，表现为"拖到一半就断、鼠标移出就拖不动"。
 *
 * 正解（用户指出）：**开始拖拽时把 move/up 绑到全局（document）**，而不是绑在手柄元素上。
 * 这样指针在页面任何位置移动都能继续驱动缩放，也不受手柄元素重建影响。
 * 本模块只管这套"全局监听 + 会话生命周期"，与 Vue 解耦，便于直接单测。
 *
 * ## 尺寸换算为什么要按"视口"而不是"当前 zoom"
 * 线上缺陷（用户原话）："reset 节点的时候，如果我同时缩放……我的鼠标和那个控件就会形成一点距离，
 * 因为这个地方没有进行反缩放"。
 *
 * 旧写法是"屏幕位移 ÷ 当前 zoom"。这只在**缩放全程不变**时成立：一旦拖拽途中缩放变了，
 * 同一段屏幕位移对应的画布位移就变了 —— 卡片越拖越偏，与鼠标拉开距离（缩放变化越大偏得越多）。
 *
 * 现在每帧都把"指针屏幕点（+ 起手抓点偏移）"用**当前视口**换算成画布坐标，再和起手时的画布角点求差。
 * 不变式：卡片右下角在**屏幕上**与鼠标保持起手时那段偏移（恒定）——也就是"控件贴住鼠标"。
 */

/** 指针事件的最小形状（DOM PointerEvent 兼容子集，便于无 DOM 单测） */
export interface PointerLike {
  clientX: number
  clientY: number
  preventDefault?(): void
  stopPropagation?(): void
}

/** 可监听目标的最小形状（浏览器传 document；测试传 fake） */
export interface PointerEventTargetLike {
  addEventListener(type: string, handler: (e: PointerLike) => void): void
  removeEventListener(type: string, handler: (e: PointerLike) => void): void
}

export interface ResizeDragOptions {
  /** 最小宽/高（拖拽下限） */
  minW: number
  minH: number
  /**
   * 屏幕坐标 → 画布(flow)坐标（**当前视口**；每帧调用，缩放/平移变化即时生效）。
   * 由渲染层提供（shell 传 flow.screenToFlow），本模块不关心视口内部结构。
   */
  toFlow: (x: number, y: number) => { x: number; y: number }
  /** 拖拽中实时尺寸回调（仅视觉，通常不落盘） */
  onLive: (w: number, h: number) => void
  /**
   * 拖拽中把尺寸同步给渲染层（VueFlow 内部重算端口位置/相连边端点）的可选回调。
   * 与 onLive 分开：onLive 只管卡片自身视觉，本回调负责"让画布其它部分跟上"。
   */
  onVisualSize?: (w: number, h: number) => void
  /** 松手提交回调（落盘） */
  onCommit: (w: number, h: number) => void
  /** 全局监听目标取值：浏览器返回 document；无 DOM 环境返回 null（此时拖拽不可用，安全降级） */
  eventTarget: () => PointerEventTargetLike | null
}

export interface ResizeDragSession {
  /**
   * 开始拖拽：记录起点与起始尺寸，并把 move/up/cancel 绑到全局。
   *
   * @param grabOffset 指针到**卡片右下角**的屏幕偏移（px）。用户抓的是拖柄中心、拖柄中心不在角上，
   *   所以这段偏移要补回来：否则一按下卡片就先跳一小段（缩放越大跳得越明显）。缺省 (0,0) = 抓点即角点。
   */
  start(e: PointerLike, startW: number, startH: number, grabOffset?: { x: number; y: number }): void
  /**
   * 用"上一次指针位置 + 当前视口"重算一次尺寸。
   *
   * 为什么需要：滚轮缩放时鼠标常常不动（没有 pointermove）。若只在 move 时重算，
   * 卡片会停在旧尺寸上、与指针短暂脱手 —— 用户报的"一点距离"。调用方（壳）在视口变化时喊一声即可。
   * 未开始/已结束会话时是空操作。
   */
  refresh(): void
  /** 是否正在拖拽 */
  readonly active: boolean
  /** 组件卸载时调用：确保全局监听被摘掉（防泄漏） */
  dispose(): void
}

interface DragState {
  startX: number
  startY: number
  startW: number
  startH: number
  /** 指针到卡片右下角的屏幕偏移（起手时捕获，之后恒定） */
  grabX: number
  grabY: number
  /** 起手时卡片右下角的**画布**坐标（用起手视口换算；之后每帧与当前值求差） */
  corner0X: number
  corner0Y: number
  /** 最近一次指针屏幕位置（refresh 时没有新事件，靠它重算） */
  mouseX: number
  mouseY: number
  w: number
  h: number
}

/**
 * 建一个 resize 拖拽会话。同一时刻只允许一个会话；重复 start 会被忽略（幂等）。
 */
export function createResizeDragSession(opts: ResizeDragOptions): ResizeDragSession {
  let state: DragState | null = null
  let unbind: (() => void) | null = null

  /** 全局 pointermove：指针走到哪都算（这正是修 bug 的关键 —— 不再要求指针留在手柄内） */
  function onMove(e: PointerLike): void {
    if (!state) return
    state.mouseX = e.clientX
    state.mouseY = e.clientY
    recompute()
  }

  /** 用当前 state 里的指针位置 + **当前视口**重算尺寸（move 与 refresh 共用） */
  function recompute(): void {
    if (!state) return
    // 用**当前视口**把"指针 + 抓点偏移"换算成画布坐标；再与起手画布角点求差。
    // 平移项在差值里相消；缩放变化时这一步才给出正确位移（旧写法此处会偏）。
    const corner = opts.toFlow(state.mouseX + state.grabX, state.mouseY + state.grabY)
    const w = Math.max(opts.minW, state.startW + (corner.x - state.corner0X))
    const h = Math.max(opts.minH, state.startH + (corner.y - state.corner0Y))
    state.w = w
    state.h = h
    opts.onLive(w, h)
    opts.onVisualSize?.(w, h)
  }

  /** 全局 pointerup / pointercancel：结束会话、摘监听、提交 */
  function onUp(): void {
    if (!state) return
    const { w, h } = state
    state = null
    unbind?.()
    unbind = null
    opts.onCommit(w, h)
  }

  return {
    start(e: PointerLike, startW: number, startH: number, grabOffset?: { x: number; y: number }): void {
      if (state) return
      e.preventDefault?.()
      e.stopPropagation?.()
      const grabX = grabOffset?.x ?? 0
      const grabY = grabOffset?.y ?? 0
      // 起手画布角点：用**起手视口**换算一次，作为后续所有差值的不动锚点
      const corner0 = opts.toFlow(e.clientX + grabX, e.clientY + grabY)
      state = {
        startX: e.clientX,
        startY: e.clientY,
        startW,
        startH,
        grabX,
        grabY,
        corner0X: corner0.x,
        corner0Y: corner0.y,
        mouseX: e.clientX,
        mouseY: e.clientY,
        w: startW,
        h: startH,
      }
      const target = opts.eventTarget()
      if (!target) return // 无全局目标（SSR/测试）：不绑监听，拖拽自然不可用
      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      // pointercancel（触摸被系统打断等）也按结束处理，避免监听残留
      target.addEventListener('pointercancel', onUp)
      unbind = () => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onUp)
      }
    },
    refresh(): void {
      recompute()
    },
    get active(): boolean {
      return state !== null
    },
    dispose(): void {
      unbind?.()
      unbind = null
      state = null
    },
  }
}
