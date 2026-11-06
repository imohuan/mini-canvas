/**
 * 标签候选菜单的搜索框（用户 2026-11-06）：必须用全局注册的 shadcn 组件，
 * 不能退回手写原生 input + 自绘边框。
 *
 * 源码契约测试：模板里出 `InputGroup` 系列组件，且搜索框不再自己画边框/底色。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const SFC = readFileSync(fileURLToPath(new URL('../node-bottom-bar/BottomBarTagMenu.vue', import.meta.url)), 'utf8')
const CSS = readBottomBarCss()

describe('标签菜单搜索框：走全局 shadcn 组件', () => {
  it('从 ui 目录取 InputGroup 系列，而不是自己拼 <input>', () => {
    expect(SFC).toContain("useUiComponent('InputGroup')")
    expect(SFC).toContain("useUiComponent('InputGroupInput')")
    expect(SFC).toContain('<InputGroupInput')
    expect(SFC).not.toMatch(/<input\s/)
  })

  it('搜索框不再写死白底/黑字（暗色主题下会糊成一块）', () => {
    const start = CSS.indexOf('.nb-tagmenu-search {')
    expect(start).toBeGreaterThan(-1)
    const block = CSS.slice(start, CSS.indexOf('}', start))
    expect(block).not.toMatch(/background\s*:\s*#fff/)
    expect(block).not.toMatch(/border\s*:\s*1px/)
    expect(block).not.toMatch(/color\s*:\s*#/)
  })

  it('清空搜索走 InputGroupButton（原生搜索框自带的蓝叉已隐藏）', () => {
    expect(SFC).toContain('<InputGroupButton')
    expect(SFC).toContain('清空搜索')
    expect(CSS).toContain('::-webkit-search-cancel-button')
    expect(CSS).toContain('-webkit-appearance: none')
  })
})
