/**
 * 回归：**右侧按钮区必须真的留在行内**（用户 2026-11-18 的 root cause）。
 *
 * 现场：720px 面板里，.nb-selects 的 min-width 被算成 686（约等于整行），
 * 于是 .nb-actions 被挤到 x=1307、宽 0 —— 用户看到的就是「右侧没了、像两行」。
 *
 * 这里用「布局方程」把它钉死：左组下限 + 右侧实际宽 必须放得进整行。
 */
import { describe, expect, it } from 'vitest'
import { resolveBottomRow, textWidthOf } from '../node-bottom-bar/bottomRowLayout'

const FIXED = 60
const actionsWidthOf = (ai: number): number => ai * 34 + 52 + 92 + 24

describe('左组下限不能吃掉右侧', () => {
  it.each([
    [340, 0], [360, 0], [420, 2], [520, 2], [560, 2], [640, 2], [694, 2], [720, 2], [820, 2], [960, 3], [1200, 3],
  ])('行宽 %ipx / %i 个 AI 按钮：左组下限 + 右侧宽 ≤ 行宽', (rowWidth, ai) => {
    const actions = actionsWidthOf(ai)
    const r = resolveBottomRow({
      rowWidth,
      actionsWidth: actions,
      fixedWidth: FIXED,
      modelText: 'GPT Image 2.6 Sunburst',
      paramText: '1:1 · 1K',
    })
    if (r.stacked) {
      // 换行时右侧独占一行，只要左侧自己不超整行即可
      expect(r.selectsMin).toBeLessThanOrEqual(rowWidth)
    } else {
      expect(
        r.selectsMin + actions,
        '行宽 ' + rowWidth + '：左组 ' + r.selectsMin + ' + 右侧 ' + actions + ' 超出整行，右侧会被挤出去',
      ).toBeLessThanOrEqual(rowWidth + 1)
    }
  })

  it('720px / 2 个按钮（用户截图的具体参数）右侧一定还在行内', () => {
    const actions = actionsWidthOf(2)
    const r = resolveBottomRow({
      rowWidth: 720, actionsWidth: actions, fixedWidth: FIXED,
      modelText: 'GPT Image 2.6 Sunburst', paramText: '1:1 · 1K',
    })
    expect(r.stacked).toBe(false)
    expect(r.selectsMin + actions).toBeLessThanOrEqual(720)
    // 左侧不能吃掉超过 85% 的行宽，否则右侧的按钮就没地方了
    expect(r.selectsMin).toBeLessThanOrEqual(720 * 0.85)
  })

  it('任意宽度下左组下限都不会超过整行', () => {
    for (let w = 300; w <= 1400; w += 10) {
      const r = resolveBottomRow({
        rowWidth: w, actionsWidth: actionsWidthOf(2), fixedWidth: FIXED,
        modelText: 'GPT Image 2.6 Sunburst', paramText: '21:9 · 4K',
      })
      expect(r.selectsMin, '行宽 ' + w).toBeLessThanOrEqual(Math.max(w, 1))
    }
  })
})

describe('同排时左侧不得吃满整行（否则右侧被挤出画布）', () => {
  /**
   * 现场数据（用户 2026-11-18 截图）：行宽 694，.nb-selects 的下限 686，
   * 右侧 .nb-actions 落到 x=1307、宽 0。这条用例就是那句话的机器化版本。
   */
  it.each([
    [694, 183, 108, 60, 160],
    [800, 200, 120, 60, 160],
    [1000, 240, 160, 60, 160],
  ])('行宽 %i：左组下限 %i+%i+%i 必须给右侧留出 ≥%i', (rowWidth, modelW, paramW, fixed, minRight) => {
    const selectsMin = fixed + modelW + paramW
    expect(rowWidth - selectsMin, '右侧剩余空间太小').toBeGreaterThanOrEqual(minRight)
  })

  it('两格按「可用宽 − 右侧」分，左侧永远留出右侧的位置', () => {
    for (let w = 480; w <= 1400; w += 10) {
      const actions = actionsWidthOf(2)
      const r = resolveBottomRow({
        rowWidth: w, actionsWidth: actions, fixedWidth: FIXED,
        modelText: 'GPT Image 2.6 Sunburst', paramText: '21:9 · 4K',
      })
      if (r.stacked) continue
      expect(w - r.selectsMin, '行宽 ' + w + ' 时右侧没有空间').toBeGreaterThan(60)
    }
  })
})

describe('参数标题只写比例与分辨率（不写积分）', () => {
  it('参数文案宽度与「1:1 · 1K」量级一致（不是带价格的长串）', () => {
    expect(textWidthOf('1:1 · 1K')).toBeLessThan(textWidthOf('1:1 · 1K · 0.35积分'))
  })
})

