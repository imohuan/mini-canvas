/**
 * 卡片上两颗悬浮按钮（用户 2026-11-06 / 2026-11-07）。
 *
 * 2026-11-06：hover 时被组件库 ghost 的 `hover:bg-muted` 盖成透明，按钮像消失 ——
 * 用「容器 → 卡片 → 按钮」三段选择器提权。
 * 2026-11-07：右下角 @ 不够明显（衬底太淡），改成实色底 + 对比字、按钮加大到 18px。
 */
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const CSS = readBottomBarCss()

function block(selector: string): string {
  const i = CSS.indexOf(selector + ' {')
  expect(i, selector).toBeGreaterThan(-1)
  return CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
}

describe('卡片悬浮按钮：看得见、hover 再加深', () => {
  for (const [label, base, hover] of [
    ['@ 按钮', '.nb-card-act', '.nb-cards .nb-card .nb-card-act:hover'],
    ['关闭按钮', '.nb-remove', '.nb-cards .nb-card .nb-remove:hover'],
  ] as const) {
    it(label + ' 有实色衬底（不是 10% 的浅灰，压在图上看不见）', () => {
      const css = block(base)
      expect(css).toMatch(/background:\s*color-mix\(/)
      expect(css).not.toMatch(/background:\s*var\(--ui-chip/)
      // 实底必须配对比字色，暗色主题下才不会同色糊掉
      expect(css).toMatch(/color:\s*var\(--ui-panel/)
    })

    it(label + ' hover 用三段选择器提权，压过组件的 hover:bg-muted', () => {
      const css = block(hover)
      expect(css).toMatch(/background:\s*color-mix\(/)
      // 必须真的写成三段（单类选择器会被 Tailwind 的 .hover\\:bg-muted:hover 盖掉）
      expect(hover.split(' ').length).toBeGreaterThanOrEqual(3)
    })
  }

  it('@ 按钮在 48px 卡片上足够大（≥18px）且字号 ≥12', () => {
    const base = block('.nb-card-act')
    const size = Number(/width:\s*(\d+)px/.exec(base)?.[1])
    expect(size).toBeGreaterThanOrEqual(18)
    expect(block('.nb-card-at')).toMatch(/font-size:\s*12px/)
  })
})
