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
    it(page + ' 从画布 ui 目录取 shadcn Select（业务插件不直接 import 组件库）', () => {
      const src = sourceOf(page)
      expect(src).not.toMatch(/from '@mini-canvas\/ui-kit-shadcn'/)
      expect(src).toContain("useUiComponent('Select')")
      expect(src).toContain("useUiComponent('SelectTrigger')")
    })
  }

  it('设置里的下拉浮层带 settings-floating-layer，且用 popper 定位', () => {
    for (const page of PAGES) {
      const src = sourceOf(page)
      expect(src, page + ' 缺浮层抬层类').toMatch(/<SelectContent[^>]*class="settings-floating-layer"/s)
      expect(src, page + ' 缺 popper 定位').toMatch(/position="popper"/)
    }
  })

  it('一个原生 <select> 都没有（主题缺席时明说，不偷偷换控件）', () => {
    for (const page of PAGES) {
      const src = sourceOf(page)
      const natives = (src.match(/<select\b/g) ?? []).length
      // 原生控件的浮层由浏览器画，样式与本项目下拉完全不是一档。
      // 取不到登记件时显示一句提示，比换成一个长得不一样的控件更好查。
      expect(natives, page + ' 里不该再有原生 select').toBe(0)
    }
  })
})
