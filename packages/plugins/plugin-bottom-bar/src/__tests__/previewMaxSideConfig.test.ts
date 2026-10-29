import { describe, expect, it } from 'vitest'
import { fitPreviewBox, resolvePreviewMaxSide } from '../previewBoxSize'

describe('resolvePreviewMaxSide（用户 2026-10-29：预览最长边可配置，默认 200）', () => {
  it('没配置 → 200', () => {
    expect(resolvePreviewMaxSide(undefined)).toBe(200)
    expect(resolvePreviewMaxSide(null)).toBe(200)
    expect(resolvePreviewMaxSide('')).toBe(200)
  })
  it('非法值（0 / 负数 / 非数字）→ 回默认 200', () => {
    expect(resolvePreviewMaxSide(0)).toBe(200)
    expect(resolvePreviewMaxSide(-50)).toBe(200)
    expect(resolvePreviewMaxSide('abc')).toBe(200)
  })
  it('合法值生效，且夹在 40~600', () => {
    expect(resolvePreviewMaxSide(300)).toBe(300)
    expect(resolvePreviewMaxSide('240')).toBe(240)
    expect(resolvePreviewMaxSide(10)).toBe(40)
    expect(resolvePreviewMaxSide(9999)).toBe(600)
  })
})

describe('fitPreviewBox 用自定义上限（卡片与标签菜单同一份配置）', () => {
  it('上限 300：横图宽 300、竖图高 300', () => {
    expect(fitPreviewBox(600, 300, 300)).toEqual({ width: 300, height: 150 })
    expect(fitPreviewBox(300, 600, 300)).toEqual({ width: 150, height: 300 })
  })
  it('竖图（用户 2026-10-29 图 2 的 327×581）：上限 200 → 113×200', () => {
    expect(fitPreviewBox(327, 581)).toEqual({ width: 113, height: 200 })
  })
})
