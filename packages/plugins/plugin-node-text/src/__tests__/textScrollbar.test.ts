/**
 * 文本节点的细滚动条几何。
 *
 * 用固定的小数字手算期望值，锁住三件事：
 * - 没溢出时不画滑块；
 * - 滑块有最小高度，长文不会缩成一根看不清的线；
 * - 拖滑块时，屏幕上的每一像素都按真实可滚距离换算。
 */
import { describe, expect, it } from 'vitest'
import { resolveScrollbarThumb, scrollStepForWheel, scrollTopForThumbDrag } from '../textScrollbar'

describe('文本节点细滚动条', () => {
  it('内容没有超出时返回 null（不显示滚动条）', () => {
    expect(
      resolveScrollbarThumb({ scrollTop: 0, scrollHeight: 100, clientHeight: 100, trackHeight: 100 }),
    ).toBeNull()
  })

  it('内容是可视高度的 4 倍 → 滑块占轨道的 1/4，停在顶部', () => {
    expect(
      resolveScrollbarThumb({ scrollTop: 0, scrollHeight: 400, clientHeight: 100, trackHeight: 120 }),
    ).toEqual({ thumbHeight: 30, thumbTop: 0, maxScrollTop: 300 })
  })

  it('滚到底 → 滑块贴住轨道底部', () => {
    expect(
      resolveScrollbarThumb({ scrollTop: 300, scrollHeight: 400, clientHeight: 100, trackHeight: 120 }),
    ).toEqual({ thumbHeight: 30, thumbTop: 90, maxScrollTop: 300 })
  })

  it('超长内容仍保留 24px 的最小滑块', () => {
    const thumb = resolveScrollbarThumb({ scrollTop: 1800, scrollHeight: 2000, clientHeight: 100, trackHeight: 120 })!
    expect(thumb.thumbHeight).toBe(24)
    expect(thumb.maxScrollTop).toBe(1900)
    // 滑块可走 120-24=96px；1800/1900 的位置 = 90.947...px（不是按轨道 120 算）
    expect(thumb.thumbTop).toBeCloseTo((1800 / 1900) * 96, 6)
  })

  it('拖滑块 18px，轨道可走 90px → 内容滚动 60px（300 × 18 / 90）', () => {
    expect(scrollTopForThumbDrag({ startScrollTop: 0, deltaY: 18, thumbTravel: 90, maxScrollTop: 300 })).toBe(60)
  })

  it('拖出两端会夹住，不会产生负滚动或超过末尾', () => {
    expect(scrollTopForThumbDrag({ startScrollTop: 10, deltaY: -100, thumbTravel: 90, maxScrollTop: 300 })).toBe(0)
    expect(scrollTopForThumbDrag({ startScrollTop: 290, deltaY: 100, thumbTravel: 90, maxScrollTop: 300 })).toBe(300)
  })

  it('滚轮一格只走 40px 内容（不再把 120px 放大成 3 倍）', () => {
    expect(scrollStepForWheel(100)).toBe(40)
    expect(scrollStepForWheel(-120)).toBe(-40)
  })
})
