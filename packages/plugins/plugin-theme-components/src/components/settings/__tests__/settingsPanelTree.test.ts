/**
 * 设置面板（PluginSettingsContent，settingsPanel 默认赢家）的结构契约 —— 用户口径 2026-11-01：
 * 「左侧带图标的导航，右侧显示当前分组的配置；顶部有标题与关闭按钮」。
 *
 * 钉住四件事：
 * ① 注册：主题插件注册的 PluginSettingsContent（order 0）就是 settingsPanel 赢家
 *    （2026-11-04 起成品应用那套面板已并入本包，ui 包不再注册换皮插件）；
 * ② 导航：按分组名推导一级项；图标来自独立场域 settings/navIcon（top(分组名)?.value），
 *    取不到用 fallback；每项 = 图标 + 名称；选中态用中性底色；
 * ③ 内容：右侧只显示当前分类；配置项一行一个（标题 + 描述 + 右侧控件）；
 * ④ 兼容：settingsGroup 内容插槽、settings.nav / settings.tab 两个注册场域都继续消费；
 *    卸载时释放滚动锁。
 * ⑤ 用户口径 2026-11-02 追加：第 0 级分类默认「常规」、右侧卡片小节、顶部页签默认隐藏、
 *    所有 number 字段统一「滑块 + 数字框」。
 *
 * 为什么仍读源码：插件包没有 @vue/server-renderer，而"导航由哪个场域取图标"这类
 * 接线事实在源码里可读，配合 chrome 实测已足够。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@plume-canvas/canvas-data'
import { ThemeRegistry } from '@plume-canvas/canvas-data'
import { themeComponentsPlugin } from '../../../index'
import PluginSettingsContent from '../PluginSettingsContent.vue'

const read = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf-8')

const SRC = read('../PluginSettingsContent.vue')
/** 只看代码、不看注释 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

/** 面板实现分成几个文件；源契约断言按职责读对应文件。 */
const MODEL = read('../settings/settingsMenuModel.ts')
const NAV_STATE = read('../settings/useSettingsNavigation.ts')
const CONTENT = read('../settings/SettingsContent.vue')
const NAV_VIEW = read('../settings/SettingsNav.vue')

const NAV_ITEM = read('../ShadcnSettingsNavItem.vue')
const NAV = read('../ShadcnSettingsNav.vue')
const CATEGORY = read('../navCategory.ts')
const FIELD = read('../SettingsSchemaField.vue')

describe('默认主题注册：PluginSettingsContent 就是设置面板赢家', () => {
  it('装默认主题插件后，settingsPanel 的赢家是 PluginSettingsContent', async () => {
    const ctx = new Context()
    ctx.inject('themeRegistry', new ThemeRegistry())
    ctx.plugin(themeComponentsPlugin)
    await ctx.start()

    const theme = ctx.get<{ winner(slot: string): unknown }>('themeRegistry')
    expect(theme.winner('settingsPanel')).toBe(PluginSettingsContent)
    ctx.stop()
  })
})

describe('PluginSettingsContent 左导航：第 0 级分类 + 图标菜单', () => {
  it('一级 = 第一个 / 分段；二级 = 后段（扁平分组取它自己）', () => {
    expect(MODEL).toMatch(/function navOf\(key: string\): string/)
    expect(MODEL).toMatch(/function leafLabelOf\(key: string\): string/)
    expect(NAV_STATE).toMatch(/const sectionMap = computed<Map<string, string\[\]>>/)
  })

  it('每项是图标 + 名称，选中项高亮', () => {
    // 导航项组件同时画图标和文字，选中态绑在按钮上；外表用 shadcn Button
    // （ghost + sm），但只保留图标 + 文字，不画组件库默认胶囊底。
    expect(NAV_ITEM).toMatch(/<Button[\s\S]*variant="ghost"/)
    expect(NAV_ITEM).toMatch(/size="sm"/)
    expect(NAV_ITEM).toMatch(/class="shadcn-nav-item"/)
    expect(NAV_ITEM).toMatch(/<component :is="iconComponent"/)
    expect(NAV_ITEM).toMatch(/\{\{ label \}\}/)
    expect(NAV_ITEM).toMatch(/:class="\{ 'is-active': active \}"/)
    // 右侧不再有旧的两级树
    expect(SRC).not.toMatch(/psd-row/)
    expect(SRC).not.toMatch(/psd-caret/)
  })

  it('左侧按第 0 级分类分组：分类标题 + 该分类下的一级菜单', () => {
    // 外观统一由 ShadcnSettingsNav 画，插件不再自绘
    expect(NAV_VIEW).toMatch(/<ShadcnSettingsNav/)
    expect(NAV).toMatch(/class="ssn-caption"/)
    expect(NAV).toMatch(/v-for="group in groups"/)
    expect(NAV).toMatch(/v-for="item in group.items"/)
    // 分类顺序固定：常规 → 集成 → 画布 → 开发（个人 + 外观已合并，2026-11-12）
    expect(CATEGORY).toMatch(/SETTINGS_CATEGORY_ORDER[^=]*=\s*\[\s*'常规'\s*,\s*'集成'\s*,\s*'画布'\s*,\s*'开发'\s*\]/)
  })

  it('没有显式分类时默认落在「常规」；旧的个人 / 外观收拢成常规', () => {
    expect(CATEGORY).toMatch(/DEFAULT_SETTINGS_CATEGORY\s*=\s*'常规'/)
    expect(CATEGORY).toMatch(/return DEFAULT_NAV_CATEGORY\[nav\] \?\? DEFAULT_SETTINGS_CATEGORY/)
    expect(CATEGORY).toMatch(/个人:\s*'常规'/)
    expect(CATEGORY).toMatch(/外观:\s*'常规'/)
  })

  it('分类可配置：meta.category 优先，其次置 navCategory 场域，再回默认表', () => {
    expect(CATEGORY).toMatch(/metaCategory\?\.trim\(\) \|\| registryCategory\?\.trim\(\)/)
    expect(CATEGORY).toMatch(/SETTINGS_NAV_CATEGORY_FIELD\s*=\s*'settings\/navCategory'/)
    // 面板从注册场读取分类，而不是各处硬编码
    expect(NAV_STATE).toMatch(/registryOf<string>\(SETTINGS_NAV_CATEGORY_FIELD\)/)
  })

  it('图标走独立场域 settings/navIcon，命中顺序由场域 order 决定', () => {
    expect(NAV_STATE).toMatch(/ctx\.registryOf<unknown>\('settings\/navIcon'\)/)
    expect(NAV_STATE).toMatch(/navIcons\?\.top\(name\)\?\.value/)
    // 取不到图标时也必须落一个兜底，不能留空位
    expect(NAV_STATE).toMatch(/\?\?\s*Circle/)
    // 图标模块导出的兜底常量仍可用（场域没登记图标时不吃空）
    expect(read('../navIcon.ts')).toMatch(/SETTINGS_NAV_ICON_FALLBACK/)
  })

  it('图标注册表声明在 navEntries 之前（否则 immediate watch 撞暂时性死区）', () => {
    // 2026-11-02 真机：打开设置只看到空白面板，控制台
    // ReferenceError: Cannot access 'ue' before initialization。
    // watch(navEntries, { immediate: true }) 在 setup 阶段就会求值；
    // iconOf 若在它之后声明，读 navIcons 会撞 TDZ。
    const iconsAt = NAV_STATE.indexOf("registryOf<unknown>('settings/navIcon')")
    const entriesAt = NAV_STATE.indexOf('const navEntries = computed')
    expect(iconsAt, '找不到图标注册表声明').toBeGreaterThan(-1)
    expect(entriesAt, '找不到 navEntries 声明').toBeGreaterThan(-1)
    expect(iconsAt, '图标注册表必须在 navEntries 之前声明').toBeLessThan(entriesAt)
  })

  it('二级小节依次排开；顶部页签条保留但默认隐藏', () => {
    // 左导航项只由一级名生成，不再为二级单独出项
    expect(SRC).toMatch(/<SettingsNav/)
    expect(SRC).not.toMatch(/v-for="leaf in leavesOf/)
    // 页签条是开关：默认 false；宿主显式打开且多于一个段时才出现
    expect(SRC).toMatch(/showSectionTabs\?: boolean/)
    expect(SRC).toMatch(/showSectionTabs: false/)
    expect(NAV_STATE).toMatch(/const showTabs = computed<boolean>\(\(\) => options\.showSectionTabs\(\) && sections\.value\.length > 1\)/)
    expect(CONTENT).toMatch(/v-if="showTabs"/)
    expect(CONTENT).toMatch(/class="psd-tabbar"/)
  })
})

describe('PluginSettingsContent 右内容：二级小标题 + 卡片 + 分割线行', () => {
  it('每个二级小节一张卡片；默认模式不按页签只显示当前段', () => {
    expect(CONTENT).toMatch(/v-for="section in sections"/)
    // 自绘整页（pageGroup 归到二级节）走 .psd-section-page；普通小节仍是一张卡片
    expect(CONTENT).toMatch(/<ShadcnSettingsSection v-else :title="section.label">/)
    expect(CONTENT).toMatch(/class="psd-section-page"/)
    expect(NAV_STATE).toMatch(/const activeEntry = computed<NavEntry \| undefined>/)
  })

  it('字段用 SettingsSchemaField，行由标题 + 描述 + 控件构成', () => {
    expect(CONTENT).toMatch(/:is="fieldRenderer"/)
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
    const ROW = read('../ShadcnSettingsRow.vue')
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
      '../ShadcnSettingsSection.vue',
    )
    expect(SECTION).toMatch(/shadcn-settings-section__title/)
    expect(SECTION).toMatch(/border: 1px solid var\(--ui-line/)
    expect(SECTION).toMatch(/border-radius: var\(--radius-panel/)
    const ROW = read(
      '../ShadcnSettingsRow.vue',
    )
    expect(ROW).toMatch(/\.shadcn-settings-row \+ \.shadcn-settings-row \{[^}]*border-top: 1px solid/s)
  })

  /**
   * 用户 2026-11-12 截图：暗色设置卡片里行与行之间是一条条亮白线。
   * 根因是组件写 var(--ui-line-faint, #eef0f4)，而主题表从没定义这个变量 ——
   * 暗色下没人覆盖，就一路掉到浅色兜底。这里钉住亮 / 暗两套都必须有值。
   */
  it('行分隔线用的 --ui-line-faint 在亮 / 暗两套主题里都有定义', () => {
    const THEME = read('../../../../../../canvas-render/src/styles/ui-theme.css')
    const light = /:root \{([\s\S]*?)\n\}/.exec(THEME)?.[1] ?? ''
    const dark = /html\.dark \{([\s\S]*?)\n\}/.exec(THEME)?.[1] ?? ''
    expect(light).toMatch(/--ui-line-faint:\s*#/)
    expect(dark).toMatch(/--ui-line-faint:\s*#/)
    // 也不能只写一个和卡片底完全一样的值（那等于没线）
    const darkValue = /--ui-line-faint:\s*(#[0-9a-f]{6})/i.exec(dark)?.[1]?.toLowerCase()
    const darkPanel = /--ui-panel:\s*(#[0-9a-f]{6})/i.exec(dark)?.[1]?.toLowerCase()
    expect(darkValue).toBeTruthy()
    expect(darkValue).not.toBe(darkPanel)
  })
})

describe('PluginSettingsContent 硬性保留：插槽、滚动锁、关闭通道', () => {
  it('消费 settingsGroup/<完整分组 key>', () => {
    expect(NAV_STATE).toMatch(/ctx\.slots\.occupants\('settingsGroup\/' \+ groupKey\)/)
  })

  it('消费 settings.nav：插件导航项按 id / meta.title 命中默认项，不重复渲染', () => {
    expect(NAV_STATE).toMatch(/ctx\.slots\.occupants\('settings\.nav'\)/)
    expect(MODEL).toMatch(/byKey\.get\(occ\.id\)/)
    expect(MODEL).toMatch(/byTitle\.get\(title\)/)
    // 命中项复用同一个 NavEntry，不新增第二个导航项
    expect(MODEL).toMatch(/hit\.kind = 'nav'/)
  })

  it('消费 settings.tab：只对当前一级生效，可顶替或追加页签', () => {
    expect(NAV_STATE).toMatch(/ctx\.slots\.occupants\('settings\.tab'\)/)
    expect(MODEL).toMatch(/occ\.id === nav \|\| occ\.id\.startsWith\(nav \+ SEP\)/)
  })

  it('关闭事件仍由外壳统一广播，面板不自己关窗', () => {
    // 面板不监听 DOM 点击/发送关闭，关闭按钮在 SettingsShell 里
    expect(CODE).not.toMatch(/settings:ui-close/)
    expect(CODE).not.toMatch(/emit\('close'\)/)
  })

  it('卸载时释放滚动锁（含摘 scrollend 监听）', () => {
    expect(NAV_STATE).toMatch(/onBeforeUnmount\(\(\) => \{[\s\S]*?releaseScrollLock\(\)/)
    const block = NAV_STATE.slice(NAV_STATE.indexOf('function releaseScrollLock'))
    expect(block).toMatch(/removeEventListener\(\s*'scrollend'/)
  })
})

describe('PluginSettingsContent 导航选中态', () => {
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
