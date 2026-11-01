/**
 * 设置页的下拉一律走主题登记件。
 *
 * 用户口径（2026-11-01）：「需要用到下拉菜单的全部使用它（ui-kit 的 Dropdown）」。
 * Agent 设置页此前有 4 处原生 <select>：样式跟主题脱节、暗色下系统控件突兀。
 * 这里不测外观（外观归主题包），只钉住「取的是登记件，而不是自己造一份」。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const PAGES = ['ModelsPage.vue', 'McpPage.vue', 'TitleModelPage.vue']

function sourceOf(name: string): string {
  return readFileSync(new URL('../components/settings/' + name, import.meta.url), 'utf-8')
}

describe('Agent 设置页的下拉', () => {
  for (const page of PAGES) {
    it(page + ' 用 useUiComponent(\'select\') 取件', () => {
      expect(sourceOf(page)).toMatch(/useUiComponent\('select'\)/)
    })
  }

  it('原生 <select> 只作为主题缺席时的回落，且每个都用 v-else 与之配对', () => {
    for (const page of PAGES) {
      const src = sourceOf(page)
      const natives = (src.match(/<select\b/g) ?? []).length
      const fallbacks = (src.match(/<select v-else/g) ?? []).length
      // 有任何原生 select，就必须全部写在回落分支里（否则主题在的时候仍会出现系统控件）。
      expect(fallbacks).toBe(natives)
    }
  })
})
