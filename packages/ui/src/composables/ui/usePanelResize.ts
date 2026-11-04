import type { UiState } from './createUiState'

/**
 * 面板拖拽与缩放：抽屉 / 停靠面板宽度。
 *
 * Agent 浮窗的拖动、停靠拖宽与右下角缩放由 AgentPanel.vue 自己管（它读 ui.agent 服务），
 * 这里不再留一份旧的 chat* 实现。
 */
export function createPanelResizeScope(state: UiState) {
  // 通用宽度拖拽（抽屉）
  function startWidthDrag(e: PointerEvent, opts: { min: number; max: () => number }): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = state.drawerWidth
    const onMove = (ev: PointerEvent): void => {
      const delta = ev.clientX - startX
      const w = Math.min(opts.max(), Math.max(opts.min, startW + delta))
      state.drawerWidth = w
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
    startWidthDrag(e, { min: 240, max: () => Math.round(window.innerWidth * 0.4) })
  return {
    startDrawerResize,
  }
}

export type PanelResizeScope = ReturnType<typeof createPanelResizeScope>

