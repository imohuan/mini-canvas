/**
 * 设置里的「快捷键」是动作项，不是空配置页。
 *
 * 用户口径（2026-11-02）：设置左导航里点「快捷键」，右侧什么都没有。
 * 根因：默认菜单登记了 nav/personal/shortcuts，但它既没有 Config 分组、
 * 也没有自绘页，面板按「空页」把它过滤掉或渲染成空白。
 *
 * 这里钉住接线：菜单带 action -> 两套面板都保留它 -> 点击广播 settings:ui-action ->
 * 宿主把它翻译成打开快捷键帮助浮层。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Context } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (rel: string): string => readFileSync(path.resolve(here, rel), 'utf-8')

describe('设置里的快捷键动作项', () => {
  it('默认菜单把「快捷键」登记为 action，而不是配置分组', async () => {
    const ctx = new Context()
    ctx.inject('themeRegistry', new (await import('@mini-canvas/canvas-data')).ThemeRegistry())
    ctx.plugin(themeDefaultPlugin)
    await ctx.start()
    const menu = ctx.get<{ resolve(groups: readonly string[]): any }>('settingsMenu')
    const view = menu.resolve([])
    const nav = view.navs.find((n: any) => n.id === 'nav/personal/shortcuts')
    expect(nav, '快捷键菜单不见了').toBeTruthy()
    expect(nav.action).toBe('shortcuts')
    // 动作项本身没有配置分组：解析层不能丢字段，否则点击没有行为
    expect(nav.sections).toEqual([])
    ctx.stop()
  })

  it('两套设置面板都保留动作项，并广播 settings:ui-action', () => {
    for (const rel of [
      '../components/settings/settings/useSettingsNavigation.ts',
      '../../../plugins/plugin-theme-default/src/components/settings/settings/useSettingsNavigation.ts',
    ]) {
      const src = read(rel)
      expect(src, rel + ' 丢掉了动作项').toMatch(/action/)
      expect(src, rel + ' 没有广播动作').toMatch(/settings:ui-action/)
    }
  })

  it('宿主把 shortcuts 动作翻译成打开快捷键帮助', () => {
    const ui = read('../composables/ui/useUiLifecycle.ts')
    expect(ui).toMatch(/settings:ui-action/)
    expect(ui).toMatch(/action === 'shortcuts'/)
    expect(ui).toMatch(/shortcutsOpen = true/)
  })

  it('动作项在被“直接 return”之前执行（默认选中也能点开）', () => {
    for (const rel of [
      '../components/settings/settings/useSettingsNavigation.ts',
      '../../../plugins/plugin-theme-default/src/components/settings/settings/useSettingsNavigation.ts',
    ]) {
      const src = read(rel)
      const fn = src.slice(src.indexOf('function selectNav('), src.indexOf('function selectSection('))
      const actionAt = fn.search(/action/)
      const earlyReturnAt = fn.search(/if \(activeNav\.value === key\) return/)
      expect(actionAt, rel + ' 没有动作分支').toBeGreaterThan(-1)
      expect(earlyReturnAt, rel + ' 没有去重分支').toBeGreaterThan(-1)
      expect(actionAt, rel + ' 的动作分支必须在去重 return 之前').toBeLessThan(earlyReturnAt)
    }
  })
})
