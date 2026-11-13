/**
 * 快捷键配置页接线：设置菜单只登记 id，页面由快捷键插件自己注册成 settings.nav occupant；
 * 主题不认识那个插件，也不 import 它。
 *
 * 这条测试守的是**主题自己的职责**：菜单里留位置、把 occupant 当 navPage 渲染。
 * 那个插件是否真的注册了页面，归它自己的测试；这里不跨插件装载，也不再读它的源码路径
 * （插件之间零引用，测试也算）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildNavEntries } from '../settings/settingsMenuModel'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const themeModel = read('../settings/settingsMenuModel.ts')
const themeContent = read('../settings/SettingsContent.vue')
const themeIndex = read('../../../index.ts')
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
