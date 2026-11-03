/**
 * 容器尺寸测量与 ResizeObserver 生命周期。
 *
 * 尺寸测量必须看真正装着 canvas 的容器：全屏时 canvas 被搬到全屏层，
 * 若还量节点内的壳，就会按节点大小渲染一张铺不满的画面。
 */
import type { PanoramaThreeState } from './threeState'

export interface PanoramaSizeOptions {
  /** 当前 canvas 实际所在的容器 */
  activeHost: () => HTMLElement | null
  /** three 对象（renderer / camera 用于同步尺寸） */
  three: () => PanoramaThreeState
}

export interface PanoramaSizeApi {
  /** 容器当前像素尺寸（拿不到时给一个兜底值，避免 0 宽高导致 WebGL 报错） */
  containerSize: () => { w: number; h: number }
  /** 按容器尺寸同步渲染器与相机 */
  syncSize: () => void
  /** 监听容器尺寸变化 */
  observeSize: (el: HTMLElement) => void
  /** 断开尺寸观察 */
  disconnectSize: () => void
}

export function usePanoramaSize(options: PanoramaSizeOptions): PanoramaSizeApi {
  let resizeObserver: ResizeObserver | null = null

  /** 容器当前像素尺寸（拿不到时给一个兜底值，避免 0 宽高导致 WebGL 报错） */
  function containerSize(): { w: number; h: number } {
    const el = options.activeHost()
    if (!el) return { w: 640, h: 400 }
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return { w: rect.width, h: rect.height }
    return { w: 640, h: 400 }
  }

  /** 按容器尺寸同步渲染器与相机（容器被 resize 时也要跟） */
  function syncSize(): void {
    const rnd = options.three().renderer.value
    const cam = options.three().camera.value
    if (!rnd || !cam) return
    const { w, h } = containerSize()
    rnd.setSize(w, h, false)
    cam.aspect = w / h
    cam.updateProjectionMatrix()
  }

  /**
   * 监听容器尺寸变化（节点被 resize 拖动时尺寸会变）。
   * 搬迁容器时（进/出全屏）重新 observe：ResizeObserver 只认观察时给的那个元素，
   * 不重挂的话全屏层尺寸变化不会被感知。
   */
  function observeSize(el: HTMLElement): void {
    if (typeof ResizeObserver === 'undefined') return
    if (!resizeObserver) resizeObserver = new ResizeObserver(() => syncSize())
    resizeObserver.disconnect()
    resizeObserver.observe(el)
  }

  function disconnectSize(): void {
    resizeObserver?.disconnect()
    resizeObserver = null
  }

  return { containerSize, syncSize, observeSize, disconnectSize }
}
