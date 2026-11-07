/**
 * 卡片上两颗悬浮按钮的 hover（用户 2026-11-06）。
 *
 * 用户实测：hover 到右上角「关闭」和右下角「@」时背景变成透明，按钮像消失。
 * 根因是组件库 Button 的 ghost 档自带 `hover:bg-muted`，优先级盖过了底栏的单类选择器。
 * 修法：默认浅灰（--ui-chip），hover 加深一档（--ui-hover-strong），
 * 并用「容器 → 卡片 → 按钮」三段选择器提权，压过组件库那条。
 */
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const CSS = readBottomBarCss()

function block(selector: string): string {
  const i = CSS.indexOf(selector + ' {')
  expect(i, selector).toBeGreaterThan(-1)
  return CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
}

describe('卡片悬浮按钮：浅灰 → 加深一档', () => {
  for (const [label, base, hover] of [
    ['@ 按钮', '.nb-card-act', '.nb-cards .nb-card .nb-card-act:hover'],
    ['关闭按钮', '.nb-remove', '.nb-cards .nb-card .nb-remove:hover'],
  ] as const) {
    it(label + ' 默认是浅灰底（不是深黑底）', () => {
      const css = block(base)
      expect(css).toMatch(/background:\s*var\(--ui-chip/)
      expect(css).not.toMatch(/background:\s*var\(--ui-ink/)
    })

    it(label + ' hover 用三段选择器提权，压过组件的 hover:bg-muted', () => {
      const css = block(hover)
      expect(css).toMatch(/background:\s*var\(--ui-hover-strong/)
      // 必须真的写成三段（单类选择器会被 Tailwind 的 .hover\\:bg-muted:hover 盖掉）
      expect(hover.split(' ').length).toBeGreaterThanOrEqual(3)
    })
  }
})
