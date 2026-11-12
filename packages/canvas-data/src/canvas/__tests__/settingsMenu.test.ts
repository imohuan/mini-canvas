/**
 * 设置菜单注册场 —— 0/1/2 级菜单的顺序与覆盖规则。
 *
 * 规则与组件场域一致：
 * - 不同 id：order 小者排前面，before / after 只改位置；
 * - 同一个 id：不同插件各占一层，order 小者赢；赢家卸载后自动露出下一层；
 * - 同一个插件同 id 再注册 = 替换自己那层。
 */
import { describe, expect, it } from 'vitest'
import { SettingsMenuRegistry } from '../settingsMenu'
import { Context } from '../context'

function category(id: string, title: string, order: number, extra: Partial<{ before: string; after: string }> = {}) {
  return { id, title, order, ...extra }
}

function nav(
  id: string,
  category: string,
  title: string,
  order: number,
  extra: Partial<{ before: string; after: string }> = {},
) {
  return { id, category, title, order, ...extra }
}

function section(
  id: string,
  nav: string,
  title: string,
  group: string,
  order: number,
  extra: Partial<{ before: string; after: string }> = {},
) {
  return { id, nav, title, group, order, ...extra }
}

describe('SettingsMenuRegistry · 0/1/2 级顺序', () => {
  it('每一级都按 order 升序，before / after 优先', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('default')

    scope.category(category('category/canvas', '画布', 40))
    scope.category(category('category/personal', '个人', 10))
    scope.category(category('category/appearance', '外观', 20))

    scope.nav(nav('nav/canvas/node', 'category/canvas', '节点', 30))
    scope.nav(nav('nav/canvas/layout', 'category/canvas', '布局', 20))
    scope.nav(nav('nav/canvas/edge', 'category/canvas', '边', 40, { after: 'nav/canvas/node' }))

    scope.section(section('section/layout/node-size', 'nav/canvas/layout', '节点尺寸', '布局/节点尺寸', 20))
    scope.section(section('section/layout/auto', 'nav/canvas/layout', '自动布局', '布局/自动布局', 10))
    scope.section(
      section('section/layout/grid', 'nav/canvas/layout', '网格', '布局/网格', 30, {
        before: 'section/layout/node-size',
      }),
    )

    const view = menu.resolve(['布局/自动布局', '布局/节点尺寸', '布局/网格'])
    expect(view.categories.map((c) => c.title)).toEqual(['个人', '外观', '画布'])
    expect(view.navs.map((n) => n.title)).toEqual(['布局', '节点', '边'])
    expect(view.navs[0].sections.map((s) => s.title)).toEqual(['自动布局', '网格', '节点尺寸'])
  })

  it('同一个 id 不同插件：order 小者赢，卸载后露出下一层', () => {
    const menu = new SettingsMenuRegistry()
    const base = menu.forPlugin('theme-default')
    const override = menu.forPlugin('my-theme')

    base.category(category('category/canvas', '画布', 40))
    base.nav(nav('nav/canvas/layout', 'category/canvas', '布局', 20))
    const extra = override.nav(nav('nav/canvas/layout', 'category/canvas', '我的布局', 5))

    expect(menu.resolve([]).navs[0].title).toBe('我的布局')
    extra.dispose()
    expect(menu.resolve([]).navs[0].title).toBe('布局')
  })

  it('同一个插件同 id 再注册 = 替换自己那层，不叠高', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('theme-default')
    scope.category(category('category/canvas', '画布', 40))
    scope.nav(nav('nav/canvas/layout', 'category/canvas', '布局', 20))
    scope.nav(nav('nav/canvas/layout', 'category/canvas', '布局（新）', 20))

    const navs = menu.resolve([]).navs
    expect(navs).toHaveLength(1)
    expect(navs[0].title).toBe('布局（新）')
  })
})

describe('SettingsMenuRegistry · 兜底不丢配置', () => {
  it('没有注册分组的配置自动挂到对应一级末尾并报告 issue', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('theme-default')
    scope.category(category('category/canvas', '画布', 40))
    scope.nav(nav('nav/canvas/layout', 'category/canvas', '布局', 20))
    scope.section(section('section/layout/auto', 'nav/canvas/layout', '自动布局', '布局/自动布局', 10))

    const view = menu.resolve(['布局/自动布局', '布局/网格'])
    const layout = view.navs.find((n) => n.title === '布局')!
    expect(layout.sections.map((s) => s.title)).toEqual(['自动布局', '网格'])
    expect(view.issues.some((i) => i.kind === 'unregistered-group')).toBe(true)
  })

  it('整个一级都没注册时，自动建到「个人」末尾，配置仍然可见', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('theme-default')
    scope.category(category('category/personal', '个人', 10))

    const view = menu.resolve(['我的插件/外观'])
    const personal = view.categories.find((c) => c.title === '个人')!
    expect(personal.navs.map((n) => n.title)).toContain('我的插件')
    expect(view.issues.some((i) => i.kind === 'unregistered-nav')).toBe(true)
  })
})

describe('SettingsMenuRegistry · 解析后的 position（最终展示顺序）', () => {
  it('position 就是最终顺序；before / after 排出来的位置不会被 order 覆盖', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('demo')
    scope.category(category('category/canvas', '画布', 40))
    scope.nav(nav('nav/canvas/layout', 'category/canvas', '布局', 20))
    scope.nav(nav('nav/canvas/tools', 'category/canvas', '工具', 50, { before: 'nav/canvas/layout' }))
    scope.section(section('section/layout/a', 'nav/canvas/layout', 'A', '布局/A', 10))
    scope.section(
      section('section/layout/b', 'nav/canvas/layout', 'B', '布局/B', 90, { before: 'section/layout/a' }),
    )

    const view = menu.resolve(['布局/A', '布局/B'])
    expect(view.categories[0].position).toBe(0)
    expect(view.categories[0].navs.map((n) => n.title)).toEqual(['工具', '布局'])
    expect(view.categories[0].navs.map((n) => n.position)).toEqual([0, 1])
    expect(view.categories[0].navs[1].sections.map((s) => s.title)).toEqual(['B', 'A'])
    expect(view.categories[0].navs[1].sections.map((s) => s.position)).toEqual([0, 1])
  })

  it('嵌套 before / after 也按最终位置编号（不按 order 另算一套）', () => {
    const menu = new SettingsMenuRegistry()
    const scope = menu.forPlugin('demo')
    scope.nav(nav('nav/root', 'category/personal', '根', 10))
    scope.nav(nav('nav/a', 'category/personal', 'A', 90, { before: 'nav/root' }))
    scope.nav(nav('nav/b', 'category/personal', 'B', 900, { after: 'nav/root' }))

    // 没登记分类时自动补的兜底分类现在叫「常规」（个人 + 外观已合并）
    const personal = menu.resolve([]).categories.find((c) => c.title === '常规')!
    expect(personal.navs.map((n) => n.title)).toEqual(['A', '根', 'B'])
    expect(personal.navs.map((n) => n.position)).toEqual([0, 1, 2])
  })
})

describe('ctx.settingsMenu · 插件注册随作用域回收', () => {
  it('插件 apply 里能注册三级菜单，卸载后自动消失', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.plugin({
      name: 'demo-settings-menu',
      apply(scope) {
        scope.settingsMenu.category({
          id: 'category/canvas',
          title: '画布',
          order: 40,
        })
        scope.settingsMenu.nav({
          id: 'nav/canvas/layout',
          category: 'category/canvas',
          title: '布局',
          order: 20,
        })
        scope.settingsMenu.section({
          id: 'section/canvas/layout/auto',
          nav: 'nav/canvas/layout',
          title: '自动布局',
          group: '布局/自动布局',
          order: 10,
        })
        seen.push('applied')
      },
    })
    await ctx.start()

    const menu = ctx.get('settingsMenu')
    expect(menu.nav('nav/canvas/layout')?.title).toBe('布局')
    expect(menu.resolve(['布局/自动布局']).navs[0].sections[0].group).toBe('布局/自动布局')

    expect(ctx.uninstallPlugin('demo-settings-menu')).toBe(true)
    expect(menu.nav('nav/canvas/layout')).toBeUndefined()
    ctx.stop()
  })

  it('before / after 只改位置，不参与同 id 的胜负', () => {
    const menu = new SettingsMenuRegistry()
    const base = menu.forPlugin('theme-default')
    const override = menu.forPlugin('my-theme')
    base.nav(nav('nav/canvas/layout', 'category/canvas', '布局', 20))
    // 同 id、更小 order：赢的是标题，与位置约束无关
    override.nav(nav('nav/canvas/layout', 'category/canvas', '我的布局', 5))
    // 另一个条目 order 更大、但 before 指向布局：它只排到前面，不抢赢家
    override.nav(nav('nav/canvas/other', 'category/canvas', '其它', 90, { before: 'nav/canvas/layout' }))

    const view = menu.resolve([])
    expect(view.navs.find((n) => n.id === 'nav/canvas/layout')!.title).toBe('我的布局')
    expect(view.navs.map((n) => n.title)).toEqual(['其它', '我的布局'])
  })

  it('同一个 id 第二个插件 order 更小 → 第二个赢；卸载后回到第一个', async () => {
    const ctx = new Context()
    const base = new SettingsMenuRegistry()
    const one = base.forPlugin('default')
    one.category({ id: 'category/canvas', title: '画布', order: 40 })
    one.nav({ id: 'nav/canvas/layout', category: 'category/canvas', title: '布局', order: 20 })
    const two = base.forPlugin('override')
    const handle = two.nav({
      id: 'nav/canvas/layout',
      category: 'category/canvas',
      title: '我的布局',
      order: 5,
    })

    expect(base.resolve([]).navs[0].title).toBe('我的布局')
    handle.dispose()
    expect(base.resolve([]).navs[0].title).toBe('布局')
    ctx.stop()
  })
})
