/**
 * 默认主题的 0/1/2 级设置菜单：注册数据与“插件只做自己的事”的覆盖规则。
 */
import { describe, expect, it } from 'vitest'
import { SettingsMenuRegistry } from '@plume-canvas/canvas-data'
import { registerDefaultSettingsMenu } from '../defaultMenu'
import { compareSettingsCategory } from '../navCategory'

describe('默认设置菜单', () => {
  it('顶层是五个分类，顺序固定', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const view = menu.resolve([])
    expect(view.categories.map((c) => c.title)).toEqual(['个人', '外观', '集成', '画布', '开发'])
    expect(view.navs.map((n) => `${n.title}`)).toEqual([
      '通用', '快捷键', '主题', '智能助手', '插件', '连接',
      '交互', '布局', '节点', '边', '工具', '调试', '演示',
    ])
  })

  it('默认二级顺序按 order（外观 → 字体 → 尺寸 → 配色）', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const theme = menu.resolve([]).navs.find((n) => n.title === '主题')!
    expect(theme.sections.map((s) => s.title)).toEqual([
      '形状', '字体', '尺寸', '浮层', '主题模式', '主题配色', '暗色主题配色', '主题工作台',
    ])
  })

  it('节点页把吸附区域、图片分档、视频分档拆成独立二级菜单', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const node = menu.resolve([
      '节点/细节', '节点/低细节', '节点/多选标记', '节点/文本LOD',
      '节点/吸附带', '节点/内容', '节点/缩略图',
    ]).navs.find((n) => n.title === '节点')!
    // 只校验本批拆出来的节点小节顺序；端口/标题/尺寸等原有小节仍在
    expect(node.sections.map((s) => s.title)).toEqual(expect.arrayContaining([
      '细节', '活动区域', '吸附区域', '图片分档', '视频分档',
    ]))
    expect(node.sections.find((s) => s.title === '细节')!.groups).not.toContain('节点/吸附带')
    // 「可视化节点分档」小节仍在，但缩略图字段已经搬到图片/视频两个独立小节
    expect(node.sections.find((s) => s.title === '可视化节点分档')!.groups).not.toContain('节点/缩略图')
    expect(node.sections.find((s) => s.title === '吸附区域')!.groups).toEqual(['节点/吸附带'])
    // 图片/视频共用同一个 Config.group，靠字段前缀切片；菜单保留两块
    expect(node.sections.find((s) => s.title === '图片分档')!.groups).toEqual(['节点/缩略图'])
    expect(node.sections.find((s) => s.title === '视频分档')!.groups).toEqual(['节点/缩略图'])
  })

  it('另一个插件不改默认表：只注册自己的 section 就能挂进已有 nav', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const plugin = menu.forPlugin('my-grid')
    plugin.section({
      id: 'section/canvas/layout/grid',
      nav: 'nav/canvas/layout',
      title: '网格',
      group: '布局/网格',
      order: 25,
    })

    const layout = menu.resolve(['布局/自动布局', '布局/网格']).navs.find((n) => n.title === '布局')!
    // grid 的 section 只声明了自己的 group；其余默认 section 因当前 groups 没有对应配置
    // 会在皮里被过滤。这里只验顺序：网格夹在自动布局(20)和分组(30)之间。
    expect(layout.sections.filter((s) => ['自动布局', '网格', '分组'].includes(s.title)).map((s) => s.title)).toEqual([
      '自动布局', '网格', '分组',
    ])
  })

  it('默认菜单里的配置分组别名与真实 Config.group 对得上（开发/演示/云/生成）', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const view = menu.resolve([
      '常规/图片生成', '常规/文本生成', '常规/上游接口', '常规/云端客户端',
      'web2api/连接', 'web2api/任务', '常规/小地图', '常规/风格库', '常规/调试',
      '常规/可视化节点', '常规/底栏',
    ])
    const flat = view.navs.flatMap((n) => n.sections).flatMap((s) => s.groups)
    for (const group of [
      '常规/图片生成', '常规/文本生成', '常规/上游接口', '常规/云端客户端',
      'web2api/连接', 'web2api/任务', '常规/小地图', '常规/风格库', '常规/调试',
      '常规/可视化节点', '常规/底栏',
    ]) {
      expect(flat).toContain(group)
    }
    // 全部都被显式 section 收编，不产生 auto 兜底（autos 为空）
    expect(view.navs.flatMap((n) => n.sections).filter((s) => s.auto)).toEqual([])
  })

  it('主题工作台只有一个 section（由整页 pageGroup 挂到它，不再多一条一级入口）', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const view = menu.resolve(['外观/主题工作台'])
    const theme = view.navs.find((n) => n.id === 'nav/appearance/theme')!
    const hits = theme.sections.filter((s) => s.groups.includes('外观/主题工作台'))
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('section/appearance/theme/lab')
    // 也没有任何一级 nav 的标题变成「主题工作台」
    expect(view.navs.map((n) => n.title)).not.toContain('主题工作台')
  })

  it('另一插件用同 id、更小 order 覆盖标题；卸载后默认标题回来', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const override = menu.forPlugin('my-theme')
    const handle = override.nav({
      id: 'nav/canvas/layout',
      category: 'category/canvas',
      title: '排布',
      order: 5,
    })

    expect(menu.resolve([]).navs.find((n) => n.id === 'nav/canvas/layout')!.title).toBe('排布')
    handle.dispose()
    expect(menu.resolve([]).navs.find((n) => n.id === 'nav/canvas/layout')!.title).toBe('布局')
  })

  it('before / after 的最终位置进 position，未被 order 重排覆盖', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    const plugin = menu.forPlugin('my-shortcuts')
    // order 故意更大：只有 after 能把它放到「通用」后面；若消费方按 order 重排会掉到末尾。
    plugin.nav({
      id: 'nav/personal/my-shortcut',
      category: 'category/personal',
      title: '我的快捷键',
      order: 900,
      after: 'nav/personal/general',
    })
    plugin.section({
      id: 'section/personal/general/extra',
      nav: 'nav/personal/general',
      title: '补充',
      group: '通用/补充',
      order: 900,
      before: 'section/personal/general/basic',
    })

    const view = menu.resolve(['通用/基础', '通用/补充'])
    const personal = view.categories.find((c) => c.id === 'category/personal')!
    expect(personal.navs.map((n) => n.title).slice(0, 2)).toEqual(['通用', '我的快捷键'])
    expect(personal.navs.map((n) => n.position)).toEqual(personal.navs.map((_, i) => i))
    const general = personal.navs[0]
    expect(general.sections.map((s) => s.title)).toEqual(['补充', '基础'])
    expect(general.sections.map((s) => s.position)).toEqual([0, 1])
  })

  it('分类也按解析后的 position 排，不只认写死的五个名字', () => {
    const menu = new SettingsMenuRegistry()
    registerDefaultSettingsMenu(menu.forPlugin('theme-default'))
    // 新分类 after「画布」：order 故意更大，验证 after 生效且不被 order 重排覆盖
    menu.forPlugin('my-lab').category({
      id: 'category/lab',
      title: '实验室',
      order: 900,
      after: 'category/canvas',
    })
    const view = menu.resolve([])
    expect(view.categories.map((c) => c.title)).toEqual(['个人', '外观', '集成', '画布', '实验室', '开发'])
    expect(view.categories.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('分类比较：position 优先；旧装配没有 position 时回落内置顺序', () => {
    // 旧装配（未接菜单）仍要有个稳定顺序：个人 → 外观 → 集成 → 画布 → 开发
    const legacy = ['开发', '个人', '画布', '外观', '集成'].map((category) => ({ category }))
    legacy.sort((a, b) => compareSettingsCategory(a, b))
    expect(legacy.map((c) => c.category)).toEqual(['个人', '外观', '集成', '画布', '开发'])

    // 新菜单：after 排出来的位置不被名字顺序覆盖
    expect(
      compareSettingsCategory({ category: '开发', position: 0 }, { category: '个人', position: 1 }),
    ).toBeLessThan(0)
  })
})
