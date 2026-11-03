import { beginViewportMove, endViewportMove } from '../../contracts/interactionContext'
import { RenderEvents } from '../renderEvents'
import type { CanvasInteractionState } from '../../contracts/interactionContext'
import type { CanvasHostHandle } from '../createMiniCanvasHost'
import type { CanvasSurfaceHandle } from './types'

export function useCanvasViewportMove(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: { value: CanvasSurfaceHandle | undefined }
  interaction: CanvasInteractionState
  persistViewport: () => boolean
  persist: () => void
  log: { log(message: string): void }
}) {
  /** 视图平移/缩放开始（pan 与 wheel/pinch 缩放同源于 VueFlow 同一套 move 事件，A 决策：统一置 paneDragging） */
  function onMoveStart(): void {
    beginViewportMove(opts.interaction)
    emitMove(RenderEvents.MoveStart)
  }

  /** 视图平移/缩放结束：清 paneDragging（与 start 对称，无 wheel/pan 配对残留问题）；并把停的位置落盘 */
  function onMoveEnd(): void {
    endViewportMove(opts.interaction)
    emitMove(RenderEvents.MoveEnd)
    if (opts.persistViewport()) opts.persist()
  }

  /**
   * paneDragging 兜底复位（自愈）：正常由 onMoveEnd 配对清除，但若 VueFlow 漏发 moveEnd
   * （或 host 重挂载丢了 end），paneDragging 会永久卡在 true —— isBusyDragging 随之恒真，
   * 消费它的显隐门（如端口按钮）就会被永久压死。这里在"任何指针抬起 / 窗口失焦"时无条件清一次：
   * 只要没有按键按住，视图移动就不可能还在进行，清掉一定安全（清了再动也有 onMoveStart 重新置位）。
   */
  function resetViewportMoveIfIdle(): void {
    if (!opts.interaction.activity.value.paneDragging) return
    opts.log.log('paneDragging 兜底复位（未收到配对 moveEnd，疑似漏发）')
    endViewportMove(opts.interaction)
  }

  /** emit 带当前视口的视图事件（host 未就绪则跳过） */
  function emitMove(event: string): void {
    const h = opts.hostRef.value
    const surface = opts.surfaceRef.value
    if (!h) return
    const vp = surface?.getViewport?.() ?? { x: 0, y: 0, zoom: 1 }
    h.ctx.emit(event, { viewport: vp })
  }

  return { onMoveStart, onMoveEnd, resetViewportMoveIfIdle }
}
