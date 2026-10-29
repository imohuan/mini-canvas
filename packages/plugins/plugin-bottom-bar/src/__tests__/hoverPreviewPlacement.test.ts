/**
 * 悬浮预览定位（用户 2026-10-29 的两张截图）：
 *
 *   · 预览图在卡片**上方**，气泡（Tooltip）在**下方** —— 两者不许重叠；
 *   · 靠屏幕顶（上方真放不下）才翻到卡片下方；
 *   · 水平居中于卡片并夹进视口（左右各留 8px）。
 */
import { describe, expect, it } from 'vitest'
import { HOVER_PREVIEW_WIDTH, placeHoverPreview } from '../hoverPreviewPlacement'

const VIEW = { width: 1600, height: 950 }
/** 造一张卡片矩形（只关心 left/top/宽高） */
const card = (left: number, top: number, size = 48) => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
  width: size,
})

describe('placeHoverPreview：一上一下，不互相遮挡', () => {
  it('正常位置：预览贴在卡片上方 10px，且标了 above（模板配 translateY(-100%)）', () => {
    const p = placeHoverPreview(card(700, 500), VIEW)
    expect(p.above).toBe(true)
    expect(p.top).toBe(490)
    // 预览框向上长（translateY(-100%)）→ 底边正好在 top，离卡片 10px
  })

  it('水平居中于卡片', () => {
    const p = placeHoverPreview(card(700, 500), VIEW)
    expect(p.left).toBe(Math.round(700 + 24 - HOVER_PREVIEW_WIDTH / 2))
  })

  it('左边贴边：夹到 8px，不出屏', () => {
    const p = placeHoverPreview(card(0, 500), VIEW)
    expect(p.left).toBe(8)
  })

  it('右边贴边：右边留 8px', () => {
    const p = placeHoverPreview(card(VIEW.width - 48, 500), VIEW)
    expect(p.left).toBe(VIEW.width - HOVER_PREVIEW_WIDTH - 8)
  })

  it('卡片很靠上（上方放不下）→ 翻到卡片下方', () => {
    const p = placeHoverPreview(card(700, 10), VIEW)
    expect(p.above).toBe(false)
    expect(p.top).toBe(10 + 48 + 10)
  })

  it('刚好放得下时不翻（边界：卡片顶 = 8 + 估算高 + 间距）', () => {
    const p = placeHoverPreview(card(700, 8 + 170 + 10), VIEW)
    expect(p.above).toBe(true)
  })
})
