/**
 * 卡片上两颗悬浮按钮（用户 2026-11-06 / 2026-11-07）。
 *
 * 2026-11-06：hover 时被组件库 ghost 的 `hover:bg-muted` 盖成透明，按钮像消失 ——
 * 用「容器 → 卡片 → 按钮」三段选择器提权。
 * 2026-11-07：@ 和关闭按钮要**同一套中性样式**，尺寸对齐左下角时长文字，
 * hover 只加深中性灰，不要主题色（关闭按钮原来是红色）。
 */
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const CSS = readBottomBarCss()

function block(selector: string): string {
  // 也接受与别的选择器合写的规则（两个名字各占一行、共用一个 {）
  const i = CSS.indexOf(selector + ' {')
  const j = i >= 0 ? i : CSS.indexOf(selector + ',')
  const k = j >= 0 ? j : CSS.indexOf(selector)
  expect(k, selector).toBeGreaterThan(-1)
  const brace = CSS.indexOf('{', k)
  return CSS.slice(brace + 1, CSS.indexOf('}', brace))
}

function singleBlock(selector: string): string {
  const i = CSS.indexOf(selector + ' {')
  expect(i, selector).toBeGreaterThan(-1)
  return CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
}

describe('卡片悬浮按钮：看得见、hover 再加深', () => {
  // 两颗按钮现在共用同一条「尺寸 + 实底」规则，先取这段共享块
  const sharedStart = CSS.indexOf('.nb-card-act,\n.nb-remove {')
  const SHARED = CSS.slice(CSS.indexOf('{', sharedStart) + 1, CSS.indexOf('}', sharedStart))

  it('@ 和关闭按钮共用一套实色衬底（不是 10% 的浅灰，压在图上看不见）', () => {
    expect(sharedStart).toBeGreaterThan(-1)
    expect(SHARED).toMatch(/background:\s*color-mix\(/)
    expect(SHARED).not.toMatch(/background:\s*var\(--ui-chip/)
    // 实底必须配对比字色，暗色主题下才不会同色糊掉
    expect(SHARED).toMatch(/color:\s*var\(--ui-panel/)
  })

  for (const [label, hover] of [
    ['@ 按钮', '.nb-cards .nb-card .nb-card-act:hover'],
    ['关闭按钮', '.nb-cards .nb-card .nb-remove:hover'],
  ] as const) {
    it(label + ' hover 用三段选择器提权，压过组件的 hover:bg-muted', () => {
      const css = block(hover)
      expect(css).toMatch(/background:\s*color-mix\(/)
      // 必须真的写成三段（单类选择器会被 Tailwind 的 .hover\\:bg-muted:hover 盖掉）
      expect(hover.split(' ').length).toBeGreaterThanOrEqual(3)
    })
  }

  it('两颗按钮尺寸一致，并与左下角时长角标的行高对齐', () => {
    // 共用一条规则：选择器里两颗都在
    expect(SHARED).toMatch(/width:\s*14px/)
    expect(SHARED).toMatch(/height:\s*14px/)
    // 与 .nb-card-duration 的 13px 行高看齐（多 1px 留出完整圆角）
    const dur = block('.nb-card-duration')
    expect(dur).toMatch(/line-height:\s*13px/)
  })

  it('关闭按钮不再出现危险色（用户不要主题色）', () => {
    expect(block('.nb-remove')).not.toMatch(/--ui-danger/)
    expect(block('.nb-cards .nb-card .nb-remove:hover')).not.toMatch(/--ui-danger/)
  })
})
