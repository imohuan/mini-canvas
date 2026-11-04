/**
 * 快捷键配置页接线：菜单项命中 settings.nav 的 page，设置面板渲染它；
 * 面板本身只做配置，不再把点击翻译成打开帮助浮层。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context, ThemeRegistry } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { shortcutManagerPlugin } from '@mini-canvas/plugin-shortcut-manager'
import { buildNavEntries } from '../settings/settingsMenuModel'
import SettingsShortcutPage from '../SettingsShortcutPage.vue'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const themeModel = read('../settings/settingsMenuModel.ts')
const themeContent = read('../settings/SettingsContent.vue')
const panel = read('../../../../../plugin-shortcut-manager/src/SettingsShortcutPanel.vue')
const bridge = read('../SettingsShortcutPage.vue')

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

  it('快捷键插件真的注册了配置页（默认菜单按 id 命中）', async () => {
    const ctx = new Context()
    ctx.inject('themeRegistry', new ThemeRegistry())
    ctx.plugin(themeDefaultPlugin)
    ctx.plugin(shortcutManagerPlugin)
    await ctx.start()

    const entry = ctx.slots
      .occupants('settings.nav')
      .find((item) => item.id === 'nav/personal/shortcuts')
    expect(entry, '快捷键配置页没有注册到 settings.nav').toBeTruthy()
    expect(entry?.meta).toMatchObject({ title: '快捷键', category: '个人' })
    ctx.stop()
  })

  it('快捷键页先安装管理器，再渲染配置面板', () => {
    const installAt = bridge.indexOf('ensureShortcutManager(')
    const renderAt = bridge.indexOf('<SettingsShortcutPanel')
    expect(installAt).toBeGreaterThan(-1)
    expect(renderAt).toBeGreaterThan(installAt)
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
        categories: [{ id: 'category/personal', title: '个人', order: 10, position: 0, navs: [] }],
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
      categoryFor: () => '个人',
      iconOf: () => null,
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.navPage).toBe(component)
    expect(entries[0]?.component).toBeUndefined()
  })
})
