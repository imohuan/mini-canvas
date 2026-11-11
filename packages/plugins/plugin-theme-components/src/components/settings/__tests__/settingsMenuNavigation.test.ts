/**
 * 0/1/2 级设置菜单：注册 → 解析 → 设置面板消费的接线契约。
 *
 * 2026-11-04 起设置面板只有默认主题这一套（成品应用那套已并入本包），
 * 所以这里只钉“界面确实会按 settingsMenu 的树渲染”，不重复测注册场的 order 规则
 *（那部分在 canvas-data 的 settingsMenu.test.ts）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@plume-canvas/canvas-data'
import { SettingsMenuRegistry } from '@plume-canvas/canvas-data'

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf-8')

const THEME = read('../PluginSettingsContent.vue')
/** 菜单推导与导航状态在 settings/ 子目录；入口只剩装配。 */
const THEME_MODEL = read('../settings/settingsMenuModel.ts')
const THEME_STATE = read('../settings/useSettingsNavigation.ts')
const NAV = read('../ShadcnSettingsNav.vue')
const CONTENT = read('../settings/SettingsContent.vue')

describe('设置菜单注册接线', () => {
  it('插件 apply 里能用 ctx.settingsMenu 注册 0/1/2 级', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'menu-fixture',
      apply(scope) {
        scope.settingsMenu.category({ id: 'category/canvas', title: '画布', order: 40 })
        scope.settingsMenu.nav({
          id: 'nav/canvas/tools',
          category: 'category/canvas',
          title: '工具',
          order: 10,
        })
        scope.settingsMenu.section({
          id: 'section/canvas/tools/minimap',
          nav: 'nav/canvas/tools',
          title: '小地图',
          group: '工具/小地图',
          order: 10,
        })
      },
    })
    await ctx.start()

    const view = ctx.get('settingsMenu').resolve(['工具/小地图'])
    expect(view.categories.map((c) => c.title)).toEqual(['画布'])
    expect(view.navs[0].title).toBe('工具')
    expect(view.navs[0].sections[0].group).toBe('工具/小地图')
    ctx.stop()
  })

  it('设置面板读 settingsMenu；没注册时仍保留旧分组兜底', () => {
    expect(THEME).toMatch(/useSettingsNavigation/)
    expect(THEME_STATE).toMatch(/resolve\(/)
    // 旧 group 兜底不能删：没注册菜单的插件配置仍然必须可见
    expect(THEME_STATE).toMatch(/groups\(\)/)
  })

  it('菜单树按第 0 级分类渲染，分类下是一级菜单', () => {
    expect(NAV).toMatch(/v-for="group in groups"/)
    expect(NAV).toMatch(/v-for="item in group.items"/)
  })

  it('第 0 级分类顺序也走菜单 order（不是只认写死的五个分类）', () => {
    // 左导航传给分组的 categoryPosition = menu.category.position；按解析后的位置排
    expect(THEME_MODEL).toMatch(/categoryPosition: entry\.categoryPosition/)
    expect(NAV).toMatch(/item\.categoryPosition/)
    expect(NAV).toMatch(/compareSettingsCategory/)
    // 旧入口（没注册菜单的分组）也要沿用本分类的最终位置，不能整组掉到最末
    expect(THEME_MODEL).toMatch(/categoryPositions\.has\(category\)/)
  })

  it('左导航保留菜单树的最终顺序，不再按原始 order 重排', () => {
    // before / after 已在注册场里落成 position；皮若再按 order 排一次，相对位置会被覆盖。
    expect(THEME_MODEL).toMatch(/return out\s*$/m)
    expect(THEME_MODEL).not.toMatch(/out\.sort\(\(a, b\) => a\.order - b\.order\)/)
  })

  it('二级段按 settingsMenu.section.order 排（注册 25 的夹在 20 和 30 之间）', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('theme-default')
    scope.category({ id: 'category/canvas', title: '画布', order: 40 })
    scope.nav({ id: 'nav/canvas/layout', category: 'category/canvas', title: '布局', order: 20 })
    scope.section({ id: 's/guide', nav: 'nav/canvas/layout', title: '对齐辅助线', group: '布局/对齐辅助线', order: 10 })
    scope.section({ id: 's/auto', nav: 'nav/canvas/layout', title: '自动布局', group: '布局/自动布局', order: 20 })
    scope.section({ id: 's/grid', nav: 'nav/canvas/layout', title: '网格', group: '布局/网格', order: 25 })
    scope.section({ id: 's/group', nav: 'nav/canvas/layout', title: '分组', group: '布局/分组', order: 30 })

    const view = menu.resolve(['布局/对齐辅助线', '布局/自动布局', '布局/网格', '布局/分组'])
    const layout = view.navs.find((n) => n.id === 'nav/canvas/layout')!
    expect(layout.sections.map((s) => s.title)).toEqual(['对齐辅助线', '自动布局', '网格', '分组'])
    // 面板必须按菜单 section 的顺序铺开，而不是 sectionMap（旧分组顺序）
    expect(THEME_MODEL).toMatch(/for \(const section of nav\.sections\)/)
    expect(THEME_MODEL).not.toMatch(/order: section\.order \?\? 1000/)
  })

  it('同一组配置可被一个 section 收拢（分组不改、菜单合并展示）', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('theme-default')
    scope.category({ id: 'category/canvas', title: '画布', order: 40 })
    scope.nav({ id: 'nav/canvas/layout', category: 'category/canvas', title: '布局', order: 20 })
    scope.section({
      id: 's/auto',
      nav: 'nav/canvas/layout',
      title: '自动布局',
      group: '布局/自动布局方向',
      groups: ['布局/自动布局间距', '布局/自动布局聚焦'],
      order: 20,
    })

    const view = menu.resolve(['布局/自动布局方向', '布局/自动布局间距', '布局/自动布局聚焦'])
    const layout = view.navs.find((n) => n.id === 'nav/canvas/layout')!
    expect(layout.sections).toHaveLength(1)
    expect(layout.sections[0].groups).toEqual(['布局/自动布局方向', '布局/自动布局间距', '布局/自动布局聚焦'])
    expect(view.issues).toEqual([])
  })

  it('旧 settings.nav 的整页（pageGroup）并入菜单二级节，只保留一条', () => {
    // 皮里的合并规则：菜单命中后 used.add(occ.id)，后续“未命中旧入口”循环会跳过；
    // 页面本身按 pageGroup 挂到对应 section.page。
    expect(THEME_MODEL).toMatch(/metaPageGroup\(item\.meta\)/)
    expect(THEME_MODEL).toMatch(/used\.add\(item\.id\)/)
    // 宽版：菜单 key 是 section id 时也要能命中主题工作台
    expect(CONTENT).toMatch(/activeEntry\.leaves\.includes\(THEME_STUDIO_NAV\)/)
    // 二级节上的整页也要真的画出来，并且宽版规则作用于它
    expect(CONTENT).toMatch(/class="psd-section-page"/)
    expect(CONTENT).toMatch(/\.psd-section-page\.is-wide/)
  })

  it('未注册 group 仍自动兜底可见，并报告 issue', () => {
    const menu = new SettingsMenuRegistry()
    menu.forPlugin('theme-default').category({ id: 'category/personal', title: '个人', order: 10 })
    const view = menu.resolve(['我的插件/外观'])
    expect(view.navs.flatMap((n) => n.sections).some((s) => s.auto)).toBe(true)
    expect(view.issues.some((i) => i.kind === 'unregistered-nav')).toBe(true)
  })
})
