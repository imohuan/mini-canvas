import { shallowRef, watch, type Ref } from 'vue'
import { GRAPH_VIEWPORT_KEY } from '@plume-canvas/canvas-data'
import type { CanvasHostHandle } from '../createPlumeHost'
import type { ViewportState } from '../../viewport/viewportService'
import type { CanvasSurfaceHandle } from './types'

/**
 * 画布视野的**唯一规则**：
 *
 * > 视野只在两个时刻确定：① 呈现之前算好；② 之后只「沿用」，用户自己动过就以用户为准。
 *
 * 关键在「呈现之前」。VueFlow 的 `default-viewport` 只在初始化那一刻读一次，
 * 挂载之后再写视口，就必然出现「先画错一帧、再改对」——那正是闪烁的来源。
 * 所以构图的时机不能是「挂载后校正」，只能是「挂载前给定」。
 *
 * 本模块只提供两件同步操作，不含任何定时器 / 轮询 / 重试：
 * - `planStartupViewport()`：数据已就绪、容器尺寸可量时算一次构图（只算，不写视口）；
 * - `restoreOnRemount()`：VueFlow 因插件装/卸整树重挂时，把当前视野原样交回给它。
 */
export function useCanvasViewport(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: Ref<CanvasSurfaceHandle | undefined>
  persistViewport: () => boolean
  /** VueFlow 整树重挂信号（插件装/卸 bump nodeEpoch） */
  remountSignal?: () => number
  /** 画布容器的像素尺寸（挂载前就能量：外壳布局已定） */
  hostSize: () => { w: number; h: number }
}) {
  const { hostRef, surfaceRef } = opts
  let stopRemountWatch: (() => void) | undefined
  /** 下一次挂载要直接用的视野（作 VueFlow 的 defaultViewport） */
  const initialViewport = shallowRef<ViewportState | null>(null)
  /** 用户亲手动过视野：之后一律以他为准，宿主不再给任何构图 */
  let userMoved = false

  /**
   * 算启动构图（**只算不写**）。
   *
   * 调用前提（由宿主保证，不在这里猜）：
   * - 插件的数据已经落进 store（`node.size` 齐全，能算出有效矩形）；
   * - 容器已在 DOM 里，能拿到像素尺寸。
   *
   * 不满足时返回 false，调用方按「没有构图」处理（空画布用 VueFlow 默认视口）。
   * 这里**不轮询等数据**：等数据是 canvasBoot 的职责，算构图只做一次。
   */
  function planStartupViewport(): boolean {
    const h = hostRef.value
    if (!h) return false
    // 用户已经自己摆好了视野：不再用“启动构图”把他拽走
    if (userMoved) return true
    if (initialViewport.value) return true
    const rects = h.view.getAllRects().filter((r) => r.w > 0 && r.h > 0)
    if (rects.length === 0) return false
    const plan = h.view.solveStartupViewport(opts.hostSize())
    if (!plan) return false
    initialViewport.value = plan
    /*
     * 故意不落盘。
     *
     * 启动构图是「按当前窗口尺寸重新算」的结果，写回去只是把同一件事在存储里记了两份；
     * 换来的是每次打开画布都多一次写（云端就是一次 PUT + 一次版本变化）。
     * 视口照旧只在用户亲手平移/缩放后落盘（见 persistViewport），供诊断与跨设备排查。
     */
    return true
  }

  /** 移动/缩放结束：把当前 viewport 记下来（重挂时原样沿用它）并按需落盘 */
  function persistViewport(): void {
    const h = hostRef.value
    if (!h) return
    const vp = h.view.getViewport()
    initialViewport.value = vp
    if (opts.persistViewport()) h.save.set(GRAPH_VIEWPORT_KEY, vp, 'canvas')
  }

  /**
   * 重挂：VueFlow 会重新创建并重新读 defaultViewport。
   *
   * 这里在重挂**发生前**（同一次更新的 pre 阶段）把当前视野写进 initialViewport，
   * 于是新的那棵 VueFlow 一出生就长在用户眼前的位置上，不需要挂载后再校正。
   */
  function restoreOnRemount(): void {
    if (!opts.remountSignal) return
    stopRemountWatch = watch(opts.remountSignal, () => {
      const h = hostRef.value
      if (!h || !surfaceRef.value) return
      const vp = h.view.getViewport()
      if (vp.zoom > 0) initialViewport.value = vp
    })
  }

  /** 用户亲手平移/缩放：从此视野归用户，宿主只在重挂时原样沿用 */
  function markUserMoved(): void {
    userMoved = true
  }

  function dispose(): void {
    stopRemountWatch?.()
    stopRemountWatch = undefined
  }

  return {
    planStartupViewport,
    persistViewport,
    restoreOnRemount,
    markUserMoved,
    initialViewport,
    dispose,
  }
}
