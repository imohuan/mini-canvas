/**
 * 全屏查看时 three canvas 的搬迁。
 *
 * 为什么搬而不是建两个渲染器：WebGL 上下文与贴图都在同一个 renderer 上，
 * 重建一份既慢又容易漏 dispose（贴图/几何全要重来）。搬 DOM 只需改尺寸并让相机重算宽高比。
 */
import type { PanoramaThreeState } from './threeState'

export interface PanoramaFullscreenOptions {
  three: () => PanoramaThreeState
  /** 当前 canvas 实际所在的容器 */
  activeHost: () => HTMLElement | null
  /** 把尺寸观察挂到新容器 */
  observeSize: (el: HTMLElement) => void
  /** 同步渲染器与相机尺寸 */
  syncSize: () => void
}

export interface PanoramaFullscreenApi {
  relocateSurface: () => void
}

export function usePanoramaFullscreen(options: PanoramaFullscreenOptions): PanoramaFullscreenApi {
  /** 把 three 的 canvas 搬到当前该待的容器里（节点内 ↔ 全屏层） */
  function relocateSurface(): void {
    const canvasEl = options.three().renderer.value?.domElement
    if (!canvasEl) return
    const target = options.activeHost()
    if (!target || canvasEl.parentElement === target) return
    target.appendChild(canvasEl)
    // 尺寸观察要跟着换成新容器，否则全屏层的尺寸变化不会被感知
    options.observeSize(target)
    options.syncSize()
  }

  return { relocateSurface }
}
