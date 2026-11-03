import type { Ref } from "vue"

export interface WaveSizeOptions {
  waveWidth: Ref<number>
  waveRef: Ref<HTMLElement | null>
  onWidthChange: () => void
}

/** 量波形区宽度并跟随尺寸变化。 */
export function useWaveSize(options: WaveSizeOptions) {
  let observer: ResizeObserver | null = null

  /** 量一次波形区宽度（固定条宽 → 根数由它算出来） */
  function measure(): void {
    const el = options.waveRef.value
    if (!el) return
    // 用 clientWidth（布局像素）而不是 getBoundingClientRect：后者含画布缩放，
    // 而条宽是布局像素 —— 两者混用会让"能放多少根"算错（实测波形只铺到一部分）。
    const w = el.clientWidth
    if (Number.isFinite(w) && w > 0 && Math.abs(w - options.waveWidth.value) > 0.5) {
      options.waveWidth.value = w
      options.onWidthChange()
    }
  }

  /** 波形元素出现时才量得到宽度（先建卡片、音频后写进来的场景靠它） */
  function observeWave(el: HTMLElement | null): void {
    observer?.disconnect()
    observer = null
    if (!el) return
    measure()
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => measure())
      observer.observe(el)
    }
  }

  function disconnect(): void {
    observer?.disconnect()
  }

  return { measure, observeWave, disconnect }
}

