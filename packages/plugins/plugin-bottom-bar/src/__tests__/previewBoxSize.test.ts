/**
 * hover 预览框尺寸（用户 2026-10-29 第 2 点）：
 *   · 按原图宽高比展示（竖图不许变成横框）；
 *   · 最长的一条边封顶 200px —— 横图限宽、竖图限高。
 */
import { describe, expect, it } from 'vitest'
import { fitPreviewBox, HOVER_PREVIEW_MAX_SIDE } from '../previewBoxSize'

describe('fitPreviewBox：按原比例，最长边 200', () => {
  it('竖图（327×581）→ 高 200、宽按比例', () => {
    const box = fitPreviewBox(327, 581)
    expect(box.height).toBe(200)
    expect(box.width).toBe(Math.round((200 * 327) / 581))
    expect(box.width).toBeLessThan(box.height)
  })

  it('横图（1600×900）→ 宽 200、高按比例', () => {
    const box = fitPreviewBox(1600, 900)
    expect(box.width).toBe(200)
    expect(box.height).toBe(Math.round((200 * 900) / 1600))
  })

  it('正方形 → 200×200', () => {
    expect(fitPreviewBox(512, 512)).toEqual({ width: 200, height: 200 })
  })

  it('最长边永远不超过 200', () => {
    for (const [w, h] of [[4000, 300], [300, 4000], [1920, 1080], [1080, 1920], [1, 1]]) {
      const box = fitPreviewBox(w, h)
      expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(HOVER_PREVIEW_MAX_SIDE)
    }
  })

  it('宽高比保持不变（误差 1px 以内）', () => {
    for (const [w, h] of [[327, 581], [1600, 900], [640, 480]]) {
      const box = fitPreviewBox(w, h)
      expect(Math.abs(box.width / box.height - w / h)).toBeLessThan(0.02)
    }
  })

  it('尺寸未知（还没 decode）→ 先给方盒子，不塌成 0', () => {
    expect(fitPreviewBox(0, 0)).toEqual({ width: 200, height: 200 })
    expect(fitPreviewBox(undefined, undefined)).toEqual({ width: 200, height: 200 })
  })

  it('极端细长图不会变成 1px 线（兜底下限 24）', () => {
    expect(fitPreviewBox(2000, 10).height).toBe(24)
  })
})
