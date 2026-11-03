import { shallowRef, watch, type Ref } from 'vue'
import { GRAPH_VIEWPORT_KEY } from '@mini-canvas/canvas-data'
import {
  FIRST_RUN_FIT_PADDING,
  FIRST_RUN_FIT_RETRY_DELAYS,
} from '../canvasHostCore'
import type { CanvasHostHandle } from '../createMiniCanvasHost'
import type { ViewportState } from '../../viewport/viewportService'
import type { CanvasSurfaceHandle } from './types'

export function useCanvasViewport(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: Ref<CanvasSurfaceHandle | undefined>
  persistViewport: () => boolean
}) {
  const { hostRef, surfaceRef } = opts
  let stopViewportRestore: (() => void) | undefined
  let viewportTimers: ReturnType<typeof setTimeout>[] = []
  /** boot 时读到的存档视口；undefined = 从未存过(首次/无历史)，走 fitView 基线 */
  const savedViewport = shallowRef<ViewportState | undefined>()

  /** 首次/无存档：对所有节点 fitView 一次(带重试等节点量测就绪)，成功后把结果存为基线 */
  function fitViewFirstRun(): void {
    const h = hostRef.value
    if (!h) return
    // 每次 fitView 的间隔：先紧后松，覆盖 text/image 自适应节点量测(ResizeObserver)完成前的空档。
    const delays = FIRST_RUN_FIT_RETRY_DELAYS
    let k = 0
    // VueFlow fitView 是 200ms 动画，调用后视口并不会立即落到目标值；故每次调用后等动画跑完再对比
    // 调用前/后的视口，判断这轮 fitView 是否真的把视口移向"包住全部节点"的居中位。以「本轮调用前」为基准
    // 而非入口一次性快照：量测就绪前用户若手动拖/缩放，拿过期入口位置比对会误判。阈值语义：
    // 位移 >0.5px 或缩放变化 >1e-4 视为已生效。
    const attempt = (): void => {
      const hh = hostRef.value
      if (!hh) return
      const before = hh.view.getViewport()
      hh.view.fitView(FIRST_RUN_FIT_PADDING)
      viewportTimers.push(
        setTimeout(() => {
          const h2 = hostRef.value
          if (!h2) return
          const after = h2.view.getViewport()
          const moved =
            Math.abs(after.x - before.x) > 0.5 ||
            Math.abs(after.y - before.y) > 0.5 ||
            Math.abs(after.zoom - before.zoom) > 0.0001
          if (moved) {
            h2.save.set(GRAPH_VIEWPORT_KEY, after, 'canvas') // 把基线落盘，二次刷新也稳定恢复
            return
          }
          if (k < delays.length) {
            viewportTimers.push(setTimeout(attempt, delays[k]))
            k++
          }
        }, 250), // >200ms 动画时长，等动画落定后再判
      )
    }
    attempt()
  }

  /** 移动/缩放结束：把当前 viewport 落盘(与 graph 同走 save，防抖 flush 统一；读视口统一走 viewport 服务) */
  function persistViewport(): void {
    const h = hostRef.value
    if (!h) return
    h.save.set(GRAPH_VIEWPORT_KEY, h.view.getViewport(), 'canvas')
  }

  function bindViewportRestore(): void {
    stopViewportRestore = watch(surfaceRef, (surface) => {
      // 空 surface(未挂载)/未启持久化 → 本次不恢复；但都提前自我停止，避免 watch 长期空转(只靠 unmount 兜底不干净)
      if (surface && hostRef.value && opts.persistViewport()) {
        const saved = savedViewport.value
        if (saved) hostRef.value.view.setViewport(saved)
        else fitViewFirstRun()
      }
      // 只需首帧执行一次；后续 VueFlow 重挂(epoch bump)不应再动视口
      stopViewportRestore?.()
      viewportTimers = []
    })
  }

  function dispose(): void {
    stopViewportRestore?.()
    for (const t of viewportTimers) clearTimeout(t)
    viewportTimers = []
  }

  return { savedViewport, fitViewFirstRun, persistViewport, bindViewportRestore, dispose }
}
