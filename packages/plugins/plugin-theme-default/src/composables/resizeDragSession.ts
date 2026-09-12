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
  /** 当前画布缩放：屏幕位移 ÷ zoom = 画布位移（缺省 1） */
  zoom: () => number
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
  /** 开始拖拽：记录起点与起始尺寸，并把 move/up/cancel 绑到全局 */
  start(e: PointerLike, startW: number, startH: number): void
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
    const z = opts.zoom() || 1
    const w = Math.max(opts.minW, state.startW + (e.clientX - state.startX) / z)
    const h = Math.max(opts.minH, state.startH + (e.clientY - state.startY) / z)
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
    start(e: PointerLike, startW: number, startH: number): void {
      if (state) return
      e.preventDefault?.()
      e.stopPropagation?.()
      state = { startX: e.clientX, startY: e.clientY, startW, startH, w: startW, h: startH }
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
