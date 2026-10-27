/**
 * LeftDrawer 插件页签接线契约。
 *
 * 这里不测像素，只锁“宿主有没有把四样东西接上”：
 * - 用基础上下文读 shell.drawer.tabs；
 * - 按钮收到 active / onSelect / host；
 * - 只渲染当前选中的插件面板；
 * - 当前页签消失时回退到画布。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(
  fileURLToPath(new URL('../components/areas/LeftDrawer.vue', import.meta.url)),
  'utf8',
)

describe('LeftDrawer 插件页签', () => {
  it('读基础上下文与 shell.drawer.tabs', () => {
    expect(src).toContain('useCanvasContext')
    expect(src).toContain("occupants('shell.drawer.tabs')")
  })

  it('按钮收到 active / onSelect / host', () => {
    expect(src).toContain(':active=')
    expect(src).toContain(':on-select=')
    expect(src).toContain(':host="drawerHost"')
  })

  it('面板只在当前页签时渲染', () => {
    expect(src).toContain('activePluginTab')
    expect(src).toContain(':is="activePluginTab.panel"')
  })

  it('当前页签消失时回退到画布', () => {
    expect(src).toContain('fallbackDrawerTab')
  })
})
