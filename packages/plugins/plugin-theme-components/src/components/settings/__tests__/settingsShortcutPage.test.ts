/**
 * 快捷键配置页接线：设置菜单只登记 id，页面由 plugin-shortcut-manager 提供；
 * 主题按名从 ui 目录取件，不再静态 import 另一个业务插件。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context, ThemeRegistry, createCanvasAppBasePlugin, MemoryStorageAdapter } from '@plume-canvas/canvas-data'
import { themeComponentsPlugin } from '../../../index'
import { shortcutManagerPlugin } from '@plume-canvas/plugin-shortcut-manager'
import { buildNavEntries } from '../settings/settingsMenuModel'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const themeModel = read('../settings/settingsMenuModel.ts')
const themeContent = read('../settings/SettingsContent.vue')
const themeIndex = read('../../../index.ts')
const panel = read('../../../../../plugin-shortcut-manager/src/SettingsShortcutPanel.vue')

describe('设置页快捷键配置页', () => {
  it('菜单模型把 settings.nav occupant 当 navPage 保留', () => {
    expect(themeModel).toMatch(/navPage\?: Component/)
    expect(themeModel).toMatch(/const navPage = !metaPage\(occ\?\.meta\)/)
    expect(themeModel).toMatch(/navPage,\n/)
  })

  it('设置面板渲染 navPage，并放在正文滚动容器里', () => {
    expect(themeContent).toMatch(/activeEntry\?\.navPage/)
    expect(themeContent).toMatch(/<component :is="activeEntry\.navPage"/)
    expect(themeContent).toMatch(/class="psd-page psd-nav-page"/)
  })

  it('面板复用 RemapPanel 与导入导出，不再只弹帮助浮层', () => {
    expect(panel).toMatch(/<RemapPanel/)
    expect(panel).toMatch(/exportKeymap/)
    expect(panel).toMatch(/importKeymap/)
    expect(panel).toMatch(/resetDefaults/)
    expect(panel).toMatch(/getConflicts/)
  })

  it('快捷键插件真的注册了配置页与按名组件（默认菜单按 id 命中）', async () => {
    const ctx = new Context()
    // 命令表由应用级底座提供：快捷键插件读不到命令表会整体不启动。
    ctx.plugin(createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter() }).plugin)
  ctx.plugin(themeComponentsPlugin)
    ctx.plugin(shortcutManagerPlugin)
    await ctx.start()

    const entry = ctx.slots
      .occupants('settings.nav')
      .find((item) => item.id === 'nav/personal/shortcuts')
    expect(entry, '快捷键配置页没有注册到 settings.nav').toBeTruthy()
    expect(entry?.meta).toMatchObject({ title: '快捷键', category: '常规' })
    expect(ctx.registryOf<unknown>('ui').keys()).toContain('settingsShortcutPanel')
    expect(ctx.tryGet('shortcut-manager')).toBeTruthy()
    ctx.stop()
  })

  it('主题不再占快捷键页，也不静态 import 快捷键插件', () => {
    // 页面与按名组件都由快捷键插件提供，主题只消费 navPage。
    // 主题拆包后通用组件只剩一个入口（themeComponents.ts 已并入 index.ts）。
    expect(themeIndex).not.toMatch(/slots\.register\(\s*['"]settings\.nav['"]/)
    expect(themeIndex).not.toContain("SettingsShortcutPage.vue")
  })

  it('没有 Config 分组、只有 settings.nav 页面时，菜单入口仍保留', () => {
    const component = { name: 'ShortcutPage' }
    const entries = buildNavEntries({
      navList: [{
        id: 'nav/personal/shortcuts',
        order: 20,
        component,
        meta: { title: '快捷键', category: '个人' },
      }],
      sectionMap: new Map(),
      groupSet: new Set(),
      menuView: {
        categories: [{ id: 'category/personal', title: '常规', order: 10, position: 0, navs: [] }],
        navs: [{
          id: 'nav/personal/shortcuts',
          category: 'category/personal',
          title: '快捷键',
          order: 20,
          position: 0,
          sections: [],
        }],
        issues: [],
      },
      categoryFor: () => '常规',
      iconOf: () => null,
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.navPage).toBe(component)
    expect(entries[0]?.component).toBeUndefined()
  })
})
