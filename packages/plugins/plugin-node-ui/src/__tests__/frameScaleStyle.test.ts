/**
 * iframe 的放大/缩小样式：四个属性必须全部由同一个倍数算出来。
 *
 * 2026-10-17 用户报「1/2、1/4、1/8 和 1 倍都没有样式」：
 * 当时写了 `if (!(n > 1)) return undefined`，把 N ≤ 1 全跳过，缩小档形同虚设。
 * 这里把每一档的算式都钉住，避免再出现「选了没反应」。
 */
import { describe, it, expect } from 'vitest'
import { RASTER_SCALES } from '../rasterTier'

/**
 * 与 UiContent.vue 的 frameStyle 同一套算式。
 *
 * 单独抄一份在这里是为了「零依赖好测」；两边算式必须保持一致，
 * 所以下面的断言把系数也写死了（改了算式两处都会红）。
 */
function frameStyleFor(n: number): Record<string, string> | undefined {
  if (!Number.isFinite(n) || Math.abs(n - 1) < 1e-6) return undefined
  return {
    width: n * 100 + '%',
    height: n * 100 + '%',
    transform: 'scale(' + 1 / n + ')',
    zoom: String(n),
    transformOrigin: 'top left',
  }
}

describe('iframe 渲染倍数样式', () => {
  it('★ 小于 1 的档必须有样式（1/2、1/4、1/8 曾经被整体跳过）', () => {
    for (const n of [0.125, 0.25, 0.5]) {
      const s = frameStyleFor(n)
      expect(s, n + ' 应该有样式').toBeDefined()
      expect(s!.width).toBe(n * 100 + '%')
      expect(s!.transform).toBe('scale(' + 1 / n + ')')
      expect(s!.zoom).toBe(String(n))
    }
  })

  it('1/2 倍的具体数值：宽 50%、zoom 0.5、放大 2 倍', () => {
    const s = frameStyleFor(0.5)!
    expect(s.width).toBe('50%')
    expect(s.height).toBe('50%')
    expect(s.zoom).toBe('0.5')
    expect(s.transform).toBe('scale(2)')
    expect(s.transformOrigin).toBe('top left')
  })

  it('大于 1 的档照旧：2 倍 → 宽 200%、zoom 2、缩回 0.5', () => {
    const s = frameStyleFor(2)!
    expect(s.width).toBe('200%')
    expect(s.zoom).toBe('2')
    expect(s.transform).toBe('scale(0.5)')
  })

  it('只有 1 倍完全不写样式（和普通节点一样）', () => {
    expect(frameStyleFor(1)).toBeUndefined()
    expect(frameStyleFor(NaN)).toBeUndefined()
  })

  it('所有可选档位要么有样式、要么恰好是 1 倍', () => {
    for (const n of RASTER_SCALES) {
      const s = frameStyleFor(n)
      if (n === 1) expect(s).toBeUndefined()
      else expect(s, n + ' 应该有样式').toBeDefined()
    }
  })
})

