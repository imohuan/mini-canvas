/**
 * 全屏预览里视频该占多大（纯函数，Node 直接跑）。
 *
 * 用户口径 2026-10-30：把画面放进舞台，保持宽高比、居中，等比放大到某一方 100%。
 * 换句话说就是标准的 contain —— 小视频（320×240）也要撑到舞台的一整条边，
 * 不能再按原始像素画成一小块（用户截图里的 1280×720 只剩中间一点点）。
 */
import { describe, it, expect } from 'vitest'
import { fitPreviewBox } from '../videoPreviewFit'

describe('fitPreviewBox：等比 contain 到舞台', () => {
  it('横屏视频吃满宽度', () => {
    expect(fitPreviewBox(1280, 720, 1200, 800)).toEqual({ width: 1200, height: 675 })
  })

  it('竖屏视频吃满高度', () => {
    expect(fitPreviewBox(720, 1280, 1200, 800)).toEqual({ width: 450, height: 800 })
  })

  it('小视频也要放大到舞台（不再按原始像素画成一小块）', () => {
    // 320×240 在 1200×800 的舞台里 → 1066.67×800，而不是 320×240
    expect(fitPreviewBox(320, 240, 1200, 800)).toEqual({ width: 1066.67, height: 800 })
  })

  it('超宽视频仍然按比例，只吃满宽度', () => {
    expect(fitPreviewBox(2560, 320, 1200, 800)).toEqual({ width: 1200, height: 150 })
  })

  it('宽高比与舞台完全一致时两边都 100%', () => {
    expect(fitPreviewBox(1600, 900, 1200, 675)).toEqual({ width: 1200, height: 675 })
  })

  it('永远不超过舞台（四舍五入不能撑出 1px）', () => {
    const box = fitPreviewBox(1000, 999, 997, 997)
    expect(box).not.toBeNull()
    expect(box!.width).toBeLessThanOrEqual(997)
    expect(box!.height).toBeLessThanOrEqual(997)
  })

  it('量不到尺寸就返回 null（调用方保持原样，不猜）', () => {
    expect(fitPreviewBox(0, 0, 1200, 800)).toBeNull()
    expect(fitPreviewBox(1280, 720, 0, 800)).toBeNull()
    expect(fitPreviewBox(Number.NaN, 720, 1200, 800)).toBeNull()
    expect(fitPreviewBox(-1280, 720, 1200, 800)).toBeNull()
  })
})
