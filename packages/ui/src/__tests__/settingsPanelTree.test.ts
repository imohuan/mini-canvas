/**
 * 设置面板（AppSettingsPanel）的结构契约 —— 用户口径 2026-11-01：
 * 「左侧带图标的导航，右侧显示当前分组的配置；顶部有标题与关闭按钮」。
 *
 * 钉住四件事：
 * ① 注册：ui-settings-panel（order -1）真的顶替了默认皮，成为 settingsPanel 赢家；
 * ② 导航：按分组名推导一级项；图标来自独立场域 settings/navIcon（top(分组名)?.value），
 *    取不到用 fallback；每项 = 图标 + 名称；选中态用中性底色；
 * ③ 内容：右侧只显示当前分类；配置项一行一个（标题 + 描述 + 右侧控件）；
 * ④ 兼容：settingsGroup 内容插槽、settings.nav / settings.tab 两个注册场域都继续消费；
 *    卸载时释放滚动锁。
 * ⑤ 用户口径 2026-11-02 追加：第 0 级分类默认「个人」、右侧卡片小节、顶部页签默认隐藏、
 *    所有 number 字段统一「滑块 + 数字框」。
 *
 * 为什么仍读源码：ui 包没有 @vue/server-renderer，而"导航由哪个场域取图标"这类
 * 接线事实在源码里可读，配合 chrome 实测已足够。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@mini-canvas/canvas-data'
import { ThemeRegistry } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { uiSettingsPanelPlugin } from '../settingsPanelPlugin'
import AppSettingsPanel from '../components/settings/AppSettingsPanel.vue'

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf-8')

const SRC = read('../components/settings/AppSettingsPanel.vue')
/** 只看代码、不看注释 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

const NAV_ITEM = read(
  '../../../plugins/plugin-theme-default/src/components/settings/ShadcnSettingsNavItem.vue',
)
const NAV = read(
  '../../../plugins/plugin-theme-default/src/components/settings/ShadcnSettingsNav.vue',
)
const CATEGORY = read(
  '../../../plugins/plugin-theme-default/src/components/settings/navCategory.ts',
)
const FIELD = read(
  '../../../plugins/plugin-theme-default/src/components/settings/SettingsSchemaField.vue',
)

describe('ui-settings-panel 注册：顶替主题默认皮成为设置面板赢家', () => {
  it('ui-settings-panel 顶替默认皮后，settingsPanel 的赢家是 AppSettingsPanel', async () => {
    const ctx = new Context()
    ctx.inject('themeRegistry', new ThemeRegistry())
    ctx.plugin(themeDefaultPlugin)
    ctx.plugin(uiSettingsPanelPlugin)
    await ctx.start()

    const theme = ctx.get<{ winner(slot: string): unknown }>('themeRegistry')
    expect(theme.winner('settingsPanel')).toBe(AppSettingsPanel)
    ctx.stop()
  })
})

describe('AppSettingsPanel 左导航：第 0 级分类 + 图标菜单', () => {
  it('一级 = 第一个 / 分段；二级 = 后段（扁平分组取它自己）', () => {
    expect(CODE).toMatch(/function navOf\(key: string\): string/)
    expect(CODE).toMatch(/function leafLabelOf\(key: string\): string/)
    expect(CODE).toMatch(/const sectionMap = computed<Map<string, string\[\]>>/)
  })

  it('每项是图标 + 名称，选中项高亮', () => {
    // 导航项组件同时画图标和文字，选中态绑在按钮上
    expect(NAV_ITEM).toMatch(/class="shadcn-nav-item"/)
    expect(NAV_ITEM).toMatch(/<component :is="iconComponent"/)
    expect(NAV_ITEM).toMatch(/\{\{ label \}\}/)
    expect(NAV_ITEM).toMatch(/:class="\{ 'is-active': active \}"/)
    // 右侧不再有旧的两级树
    expect(SRC).not.toMatch(/asp-row/)
    expect(SRC).not.toMatch(/asp-caret/)
  })

  it('左侧按第 0 级分类分组：分类标题 + 该分类下的一级菜单', () => {
    // 两套皮共用同一个导航组件，插件不再自绘
    expect(SRC).toMatch(/<ShadcnSettingsNav/)
    expect(NAV).toMatch(/class="ssn-caption"/)
    expect(NAV).toMatch(/v-for="group in groups"/)
    expect(NAV).toMatch(/v-for="item in group.items"/)
    // 分类顺序固定：个人 → 外观 → 集成 → 画布 → 开发
    expect(CATEGORY).toMatch(/SETTINGS_CATEGORY_ORDER[^=]*=\s*\[\s*'个人'\s*,\s*'外观'\s*,\s*'集成'\s*,\s*'画布'\s*,\s*'开发'\s*\]/)
  })

  it('没有显式分类时默认落在「个人」', () => {
    expect(CATEGORY).toMatch(/DEFAULT_SETTINGS_CATEGORY\s*=\s*'个人'/)
    expect(CATEGORY).toMatch(/return DEFAULT_NAV_CATEGORY\[nav\] \?\? DEFAULT_SETTINGS_CATEGORY/)
  })

  it('分类可配置：meta.category 优先，其次置 navCategory 场域，再回默认表', () => {
    expect(CATEGORY).toMatch(/metaCategory\?\.trim\(\) \|\| registryCategory\?\.trim\(\)/)
    expect(CATEGORY).toMatch(/SETTINGS_NAV_CATEGORY_FIELD\s*=\s*'settings\/navCategory'/)
    // 两套皮都从同一个注册场读取
    expect(CODE).toMatch(/registryOf<string>\(SETTINGS_NAV_CATEGORY_FIELD\)/)
    const THEME_SETTINGS = read(
      '../../../plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue',
    )
    expect(THEME_SETTINGS).toMatch(/registryOf<string>\(SETTINGS_NAV_CATEGORY_FIELD\)/)
  })

  it('图标走独立场域 settings/navIcon，命中顺序由场域 order 决定', () => {
    expect(CODE).toMatch(/ctx\.registryOf<unknown>\('settings\/navIcon'\)/)
    expect(CODE).toMatch(/navIcons\?\.top\(name\)\?\.value/)
    // 取不到图标时也必须落一个兜底，不能留空位
    expect(CODE).toMatch(/\?\?\s*Circle/)
    // 默认皮使用导航图标模块导出的兜底常量
    const THEME_SETTINGS = read(
      '../../../plugins/plugin-theme-default/src/components/settings/PluginSettingsContent.vue',
    )
    expect(THEME_SETTINGS).toMatch(/SETTINGS_NAV_ICON_FALLBACK/)
  })

  it('二级小节依次排开；顶部页签条保留但默认隐藏', () => {
    // 左导航项只由一级名生成，不再为二级单独出项
    expect(SRC).toMatch(/:items="navItems"/)
    expect(SRC).not.toMatch(/v-for="leaf in leavesOf/)
    // 页签条是开关：默认 false；宿主显式打开且多于一个段时才出现
    expect(SRC).toMatch(/showSectionTabs\?: boolean/)
    expect(SRC).toMatch(/showSectionTabs: false/)
    expect(SRC).toMatch(/const showTabs = computed<boolean>\(\(\) => props\.showSectionTabs && sections\.value\.length > 1\)/)
    expect(SRC).toMatch(/v-if="showTabs"/)
    expect(SRC).toMatch(/class="asp-tabbar"/)
  })
})

describe('AppSettingsPanel 右内容：二级小标题 + 卡片 + 分割线行', () => {
  it('每个二级小节一张卡片；默认模式不按页签只显示当前段', () => {
    expect(SRC).toMatch(/v-for="section in sections"/)
    // 自绘整页（pageGroup 归到二级节）走 .asp-section-page；普通小节仍是一张卡片
    expect(SRC).toMatch(/<ShadcnSettingsSection v-else :title="section.label">/)
    expect(SRC).toMatch(/class="asp-section-page"/)
    expect(CODE).toMatch(/const activeEntry = computed<NavEntry \| undefined>/)
  })

  it('字段用 SettingsSchemaField，行由标题 + 描述 + 控件构成', () => {
    expect(CODE).toMatch(/:is="FieldRenderer"/)
    // 字段渲染器本身改成一行一项：开关/下拉/输入/数字各一条
    expect(FIELD).toMatch(/ShadcnSettingsRow/)
    expect(FIELD).toMatch(/<Switch/)
    expect(FIELD).toMatch(/<Select/)
    expect(FIELD).toMatch(/<Input/)
    expect(FIELD).toMatch(/<Slider/)
    expect(FIELD).toMatch(/<NumberField/)
    expect(FIELD).toMatch(/<ColorPicker/)
    // 取色器要浮在正文之上，滚动时不被裁切
    expect(FIELD).toMatch(/<PopoverContent/)
    // 配置项左边标题、右边控件：行组件用左右两栏
    const ROW = read('../../../ui-kit-shadcn/src/components/settings/SettingsRow.vue')
    expect(ROW).toMatch(/justify-content: space-between/)
    expect(ROW).toMatch(/shadcn-settings-row__label/)
    expect(ROW).toMatch(/shadcn-settings-row__desc/)
  })

  it('所有 number 字段只有「滑块 + 数字框」一种形式（没有纯输入分支）', () => {
    expect(FIELD).not.toMatch(/useStepInput/)
    expect(FIELD).toMatch(/entry\.schema\.type === 'number'[\s\S]*?<Slider/)
    expect(FIELD).toMatch(/entry\.schema\.type === 'number'[\s\S]*?<NumberField/)
    expect(FIELD).toMatch(/entry\.schema\.type === 'number'[\s\S]*?NumberFieldDecrement/)
    expect(FIELD).toMatch(/entry\.schema\.type === 'number'[\s\S]*?NumberFieldIncrement/)
  })

  it('小标题下是卡片；卡片里的行之间是分割线', () => {
    const SECTION = read(
      '../../../ui-kit-shadcn/src/components/settings/SettingsSection.vue',
    )
    expect(SECTION).toMatch(/shadcn-settings-section__title/)
    expect(SECTION).toMatch(/border: 1px solid var\(--ui-line/)
    expect(SECTION).toMatch(/border-radius: var\(--radius-panel/)
    const ROW = read(
      '../../../ui-kit-shadcn/src/components/settings/SettingsRow.vue',
    )
    expect(ROW).toMatch(/\.shadcn-settings-row \+ \.shadcn-settings-row \{[^}]*border-top: 1px solid/s)
  })
})

describe('AppSettingsPanel 硬性保留：插槽、滚动锁、关闭通道', () => {
  it('消费 settingsGroup/<完整分组 key>', () => {
    expect(CODE).toMatch(/ctx\.slots\.occupants\('settingsGroup\/' \+ groupKey\)/)
  })

  it('消费 settings.nav：插件导航项按 id / meta.title 命中默认项，不重复渲染', () => {
    expect(CODE).toMatch(/ctx\.slots\.occupants\('settings\.nav'\)/)
    expect(CODE).toMatch(/byKey\.get\(occ\.id\)/)
    expect(CODE).toMatch(/byTitle\.get\(title\)/)
    // 命中项复用同一个 NavEntry，不新增第二个导航项
    expect(CODE).toMatch(/hit\.kind = 'nav'/)
  })

  it('消费 settings.tab：只对当前一级生效，可顶替或追加页签', () => {
    expect(CODE).toMatch(/ctx\.slots\.occupants\('settings\.tab'\)/)
    expect(CODE).toMatch(/occ\.id === nav \|\| occ\.id\.startsWith\(nav \+ SEP\)/)
  })

  it('关闭事件仍由外壳统一广播，面板不自己关窗', () => {
    // 面板不监听 DOM 点击/发送关闭，关闭按钮在 SettingsShell 里
    expect(CODE).not.toMatch(/settings:ui-close/)
    expect(CODE).not.toMatch(/emit\('close'\)/)
  })

  it('卸载时释放滚动锁（含摘 scrollend 监听）', () => {
    expect(CODE).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]*?releaseScrollLock\(\)/)
    const block = CODE.slice(CODE.indexOf('function releaseScrollLock'))
    expect(block).toMatch(/removeEventListener\(\s*'scrollend'/)
  })
})

describe('AppSettingsPanel 导航选中态', () => {
  it('未选中统一弱化色；选中用中性浅底 + 正常文字色', () => {
    expect(NAV_ITEM).toMatch(/\.shadcn-nav-item\.is-active \{/)
    expect(NAV_ITEM).toMatch(/background: var\(--ui-panel-active/)
    expect(NAV_ITEM).toMatch(/color: var\(--ui-ink/)
    const active = /\.shadcn-nav-item\.is-active \{([^}]*)\}/.exec(NAV_ITEM)?.[1] ?? ''
    expect(active).not.toMatch(/--ui-accent/)
    const base = /\.shadcn-nav-item \{([^}]*)\}/.exec(NAV_ITEM)?.[1] ?? ''
    expect(base).toMatch(/color: var\(--ui-ink-dim/)
    expect(base).not.toMatch(/opacity:/)
  })
})
