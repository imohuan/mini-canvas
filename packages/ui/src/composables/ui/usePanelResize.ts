import type { UiState } from './createUiState'

/**
 * 面板拖拽与缩放：Agent 浮窗拖动、抽屉/停靠面板宽度、浮窗右下角。
 *
 * 监听器挂载/摘除与夹取边界完全照搬原实现。
 */
export function createPanelResizeScope(state: UiState) {
  // ===== 面板拖拽（宽度 / 位置）=====
  let chatDragStart = { x: 0, y: 0, left: 0, top: 0 }
  let chatEl: HTMLElement | null = null
  function onChatDrag(e: PointerEvent): void {
    const w = chatEl?.offsetWidth ?? 400
    const h = chatEl?.offsetHeight ?? 640
    // 面板完整可见（四周留 4px），拖不出去
    state.chatPos = {
      x: Math.min(window.innerWidth - w - 4, Math.max(4, chatDragStart.left + (e.clientX - chatDragStart.x))),
      y: Math.min(window.innerHeight - h - 4, Math.max(4, chatDragStart.top + (e.clientY - chatDragStart.y))),
    }
  }
  function stopChatDrag(): void {
    window.removeEventListener('pointermove', onChatDrag)
    window.removeEventListener('pointerup', stopChatDrag)
  }
  function startChatDrag(e: PointerEvent): void {
    if (state.chatDocked) return
    const el = (e.currentTarget as HTMLElement).closest('.chat-panel') as HTMLElement | null
    if (!el || (e.target as HTMLElement).closest('button')) return
    chatEl = el
    const r = el.getBoundingClientRect()
    chatDragStart = { x: e.clientX, y: e.clientY, left: r.left, top: r.top }
    window.addEventListener('pointermove', onChatDrag)
    window.addEventListener('pointerup', stopChatDrag)
    e.preventDefault()
  }
  // 通用宽度拖拽（抽屉 / 停靠面板）
  function startWidthDrag(e: PointerEvent, opts: { fromRight?: boolean; min: number; max: () => number; target: 'drawer' | 'chat' }): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = opts.target === 'drawer' ? state.drawerWidth : state.chatWidth
    const onMove = (ev: PointerEvent): void => {
      const delta = opts.fromRight ? startX - ev.clientX : ev.clientX - startX
      const w = Math.min(opts.max(), Math.max(opts.min, startW + delta))
      if (opts.target === 'drawer') state.drawerWidth = w
      else state.chatWidth = w
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }
  const startDrawerResize = (e: PointerEvent): void =>
    startWidthDrag(e, { min: 240, max: () => Math.round(window.innerWidth * 0.4), target: 'drawer' })
  const startChatResize = (e: PointerEvent): void =>
    startWidthDrag(e, { fromRight: true, min: 360, max: () => Math.round(window.innerWidth * 0.55), target: 'chat' })
  /** 浮窗右下角自由缩放（宽高一起拖，夹在最小值与视口之间） */
  function startChatCornerResize(e: PointerEvent): void {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const startW = state.chatWidth
    const startH = state.chatHeight
    // 首次 resize：把「bottom 锚定」转成「top 锚定」，之后宽高以左上角为基准向右下生长
    const panel = document.querySelector('.chat-panel') as HTMLElement | null
    const pr = panel?.getBoundingClientRect()
    const startLeft = pr?.left ?? 0
    const startTop = pr?.top ?? 0
    if (panel && !state.chatPos) {
      state.chatPos = { x: startLeft, y: startTop }
    }
    const onMove = (ev: PointerEvent): void => {
      // 右下角手柄：往左上拖 = 缩小，往右下拖 = 放大
      // 右缘/下缘都不许越过视口（留 8px 边距），且不小于最小值
      const maxW = Math.max(state.chatMinW, window.innerWidth - 8 - startLeft)
      const maxH = Math.max(state.chatMinH, window.innerHeight - 8 - startTop)
      state.chatWidth = Math.min(maxW, Math.max(state.chatMinW, startW + (ev.clientX - startX)))
      state.chatHeight = Math.min(maxH, Math.max(state.chatMinH, startH + (ev.clientY - startY)))
      // 下缘不许出屏：空间不足以放下最小高度时，把面板整体上移，保证 bottom ≤ 视口-8
      if (state.chatPos) {
        const maxY = window.innerHeight - 8 - state.chatHeight
        if (state.chatPos.y > maxY) state.chatPos = { ...state.chatPos, y: Math.max(4, maxY) }
      }
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
  }
  return {
    startChatDrag, startDrawerResize, startChatResize, startChatCornerResize,
  }
}

export type PanelResizeScope = ReturnType<typeof createPanelResizeScope>

