/**
 * 标签菜单的 hover 预览定位（用户 2026-11-25 截图 2：预览跑到屏幕外）。
 *
 * 旧实现把预览摆在行的左右两侧、只夹纵向 —— 菜单贴着视口边缘时横向坐标越界。
 * 现在与卡片 hover 预览同一套规则：水平居中并夹进视口，优先上方、放不下才翻到下方。
 */
import { describe, expect, it } from 'vitest'
import { placeMenuRowPreview } from '../hoverPreviewPlacement'

const VIEW = { width: 1200, height: 800 }
const row = (left: number, top: number, width = 260) => ({
  left,
  right: left + width,
  top,
  bottom: top + 34,
  width,
})

describe('placeMenuRowPreview', () => {
  it('普通位置：在上方 10px，并标 above（模板配 translateY(-100%)）', () => {
    const p = placeMenuRowPreview(row(400, 300), VIEW, { width: 200, height: 200 })
    expect(p.above).toBe(true)
    expect(p.top).toBe(290)
  })

  it('行贴着视口左边：预览居中于该行，且不越出左边框', () => {
    const p = placeMenuRowPreview(row(0, 300), VIEW, { width: 200, height: 200 })
    expect(p.left).toBe(30) // 行中心 130 − 半宽 100
    expect(p.left).toBeGreaterThanOrEqual(8)
  })

  it('行贴着视口右边（行比预览宽）：不越出右边框', () => {
    const p = placeMenuRowPreview(row(VIEW.width - 260, 300), VIEW, { width: 400, height: 200 })
    expect(p.left).toBe(VIEW.width - 400 - 8)
  })

  it('行很靠上：翻到下方，不跑出屏幕', () => {
    const p = placeMenuRowPreview(row(400, 4), VIEW, { width: 200, height: 200 })
    expect(p.above).toBe(false)
    expect(p.top).toBe(4 + 34 + 10)
  })

  it('按预览框真实尺寸判断（竖图更高，临界点更早翻）', () => {
    const tall = { width: 60, height: 200 }
    // 卡片顶 − 盒高 − 间距 = 卡顶 − 210；卡顶 218 时正好 8px（放得下），217 就翻
    expect(placeMenuRowPreview(row(400, 218), VIEW, tall).above).toBe(true)
    expect(placeMenuRowPreview(row(400, 217), VIEW, tall).above).toBe(false)
  })
})
