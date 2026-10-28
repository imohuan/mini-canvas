/**
 * 设置面板换皮（AppSettingsPanel）的**结构契约** —— 用户口径 2026-10-09：
 * 「左侧树形菜单（两层，折叠 + 缩进），右侧显示全部配置，点左侧滚到对应位置；
 *   并且我这边不需要那个插槽。」
 *
 * 钉两件事：
 * ① **注册**：ui-settings-panel（order -1）真的顶替了主题默认皮成为 settingsPanel 赢家
 *    （真内核 + 真插件跑一遍，少一步接线这条就红）；
 * ② **结构**：左树由 settings.groups() 的分组名推导（一级/二级），只消费 settingsGroup 内容插槽、
 *    **不消费** settingsNav / settingsTab（用户明确不需要这两个插槽）。
 *
 * 为什么用源码断言而不是 SSR：ui 包没有 @vue/server-renderer（不比 theme-default）；
 * 而"树怎么长、点了做什么"这些结构事实在源码里可读，配合浏览器实测（真点击/真滚动）已足够。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Context } from '@mini-canvas/canvas-data'
import { ThemeRegistry } from '@mini-canvas/canvas-data'
import { themeDefaultPlugin } from '@mini-canvas/plugin-theme-default'
import { uiSettingsPanelPlugin } from '../settingsPanelPlugin'
import AppSettingsPanel from '../components/settings/AppSettingsPanel.vue'

const SRC = readFileSync(new URL('../components/settings/AppSettingsPanel.vue', import.meta.url), 'utf-8')
/** 只看代码、不看注释：注释里出现的 settingsNav/settingsTab 是"本面板不消费它们"的说明，不算证据 */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')

describe('ui-settings-panel 注册：顶替主题默认皮成为设置面板赢家', () => {
  it('ui-settings-panel 顶替默认皮后，settingsPanel 的赢家是 AppSettingsPanel', async () => {
    const ctx = new Context()
    ctx.inject('themeRegistry', new ThemeRegistry())
    ctx.plugin(themeDefaultPlugin)
    ctx.plugin(uiSettingsPanelPlugin)
    await ctx.start()

    const theme = ctx.get<{ winner(slot: string): unknown }>('themeRegistry')
    // 默认皮没被删：把本插件移出装配即自然回退
    expect(theme.winner('settingsPanel')).toBe(AppSettingsPanel)
    ctx.stop()
  })
})

describe('AppSettingsPanel 左树：两层树从分组名推导', () => {
  it('一级 = 第一个 / 分段；二级 = 后段（扁平分组取它自己）', () => {
    expect(CODE).toMatch(/const navOf = \(key: string\): string => key\.split\(SEP\)\[0\]/)
    expect(CODE).toMatch(/const leafLabelOf/)
    // 树：一级 → 完整分组 key 列表
    expect(CODE).toMatch(/const tree = computed<Map<string, string\[\]>>/)
  })

  it('折叠箭头只画在真能折叠的一级行上（二级是叶子、不画箭头）', () => {
    expect(CODE).toMatch(/const collapsed = ref<Set<string>>\(new Set\(\)\)/)
    expect(CODE).toMatch(/function toggleNav\(nav: string\): void/)
    // 二级行里没有任何折叠按钮
    const l2Row = /class="asp-row asp-row--l2"[\s\S]*?<\/div>/.exec(SRC)?.[0] ?? ''
    expect(l2Row, '二级行不应出现折叠按钮').not.toMatch(/asp-caret/)
    // 折叠箭头是"有多个子节点"分支专属（solo 分支不渲染它）
    expect(SRC).toMatch(/class="asp-caret"/)
  })

  it('只有一个子节点的一级被合并成一条平级项（不再拆两级、不做折叠）', () => {
    expect(CODE).toMatch(/function isSolo\(nav: string\): boolean/)
    expect(CODE).toMatch(/function soloLeafOf\(nav: string\): string/)
    // 左树：solo 分支渲染一条 asp-row--solo（走 selectLeaf，不折叠）
    expect(SRC).toMatch(/v-if="isSolo\(nav\)"[\s\S]*?asp-row--solo[\s\S]*?selectLeaf\(soloLeafOf\(nav\)\)/)
    // 右侧：solo 段只有一个小标题、没有独立的二级小标题
    expect(SRC).toMatch(/v-if="isSolo\(nav\)"[\s\S]*?data-sec="soloLeafOf\(nav\)"[\s\S]*?data-nav="nav"/)
  })

  it('二级相对一级缩进（左树两级视觉层级）', () => {
    // 二级文字必须比一级文字更靠右（一级文字起点 24px、二级 44px）
    expect(SRC).toMatch(/\.asp-label--l2 \{[^}]*padding-left: 44px/)
  })

  it('折叠按钮：点击区域够大、不给背景（hover 只变图标色）', () => {
    // .asp-caret 有两条规则：尺寸那条给点击区域、外观那条给颜色
    const caretBlocks = [...SRC.matchAll(/(^|\n)\.asp-caret \{([^}]*)\}/g)].map((m) => m[2])
    const merged = caretBlocks.join('\n')
    expect(merged, '箭头按钮应有较大的点击区域').toMatch(/width: 24px/)
    expect(merged, '箭头按钮不应有背景').toMatch(/background: transparent/)
    // 任何一条 .asp-caret 规则都不该出现非 transparent 的背景
    expect(caretBlocks.some((b) => /background:(?! transparent)/.test(b)), '箭头按钮不应有底色').toBe(false)
    // hover 规则里不能出现 background
    const hoverRule = /\.asp-caret:hover \{([^}]*)\}/.exec(SRC)?.[1] ?? ''
    expect(hoverRule, 'hover 不应改变背景').not.toMatch(/background/)
    expect(hoverRule, 'hover 应改变图标颜色').toMatch(/color:/)
  })
})

describe('AppSettingsPanel 交互：点左侧滚到对应位置', () => {
  it('点一级/二级都调用 scrollToEl 把右侧长列表滚过去', () => {
    expect(CODE).toMatch(/function selectNav\(nav: string\): void/)
    expect(CODE).toMatch(/function selectLeaf\(key: string\): void/)
    expect(CODE).toMatch(/function scrollToEl\(el: HTMLElement\): void/)
    // 两个入口都走滚动
    expect((CODE.match(/scrollToEl\(/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('右侧滚动时左树跟着定位（scroll-spy：记录当前段并把对应行滚进可视区）', () => {
    expect(SRC).toMatch(/@scroll="onBodyScroll"/)
    expect(CODE).toMatch(/function onBodyScroll\(\): void/)
    // 当前段 → 左树对应行 scrollIntoView
    expect(CODE).toMatch(/scrollIntoView\(\{ block: 'nearest' \}\)/)
  })

  it('当前项是"定位锚点"选中态：主题色浅底 + 主题色文字、无边框', () => {
    // 选中态走主题强调色浅底（与 hover 的中性灰区分，暗色下也看得见）
    expect(SRC).toMatch(/\.asp-row\.is-current \{[^}]*background: var\(--ui-accent-soft/)
    // 选中项文字也染主题色
    expect(SRC).toMatch(/\.asp-row\.is-current \.asp-label \{[^}]*color: var\(--ui-accent/)
    // 高亮只靠背景+文字色，不能有边框
    const rule = /\.asp-row\.is-current \{([^}]*)\}/.exec(SRC)?.[1] ?? ''
    expect(rule, '当前项不应有边框').not.toMatch(/border/)
    // 也不靠加粗文字来表达选中
    expect(SRC).not.toMatch(/\.is-current[^{]*\{[^}]*font-weight/)
    // is-current 规则必须排在 :hover 之后（否则鼠标停在选中项上会被 hover 的灰压下去）
    const hoverAt = SRC.indexOf('.asp-row:hover')
    const currentAt = SRC.indexOf('.asp-row.is-current {')
    expect(hoverAt, '找不到 :hover 规则').toBeGreaterThan(-1)
    expect(currentAt, 'is-current 规则应排在 :hover 之后').toBeGreaterThan(hoverAt)
  })

  it('二级亮的时候一级不亮（高亮只落在"当前那一段"）', () => {
    // 一级行不带任何 is-current 绑定
    expect(SRC).toMatch(/<div class="asp-row asp-row--l1">/)
    expect(SRC).not.toMatch(/asp-row--l1"\s*:class="\{\s*'is-current'/)
    // 二级行与合并项才带 is-current
    expect(SRC).toMatch(/asp-row asp-row--l2"\s*\n?\s*:class="\{ 'is-current': currentKey === leaf \}"/)
    expect(SRC).toMatch(/asp-row--solo"[\s\S]{0,80}'is-current': currentKey === soloLeafOf\(nav\)/)
  })
})

describe('AppSettingsPanel 右侧：字段不套卡片、直接铺开', () => {
  it('二级段是"小标题 + 字段"，不再有卡片容器（圆角/描边/底色一并去掉）', () => {
    // 段标题 + 段正文两层结构在
    expect(SRC).toMatch(/class="asp-section-title"/)
    expect(SRC).toMatch(/class="asp-section-body"/)
    // 段容器不再带卡片式描边/圆角/底色
    const sectionRule = /(^|\n)\.asp-section \{([^}]*)\}/.exec(SRC)?.[2] ?? ''
    expect(sectionRule, '段容器不应再有卡片样式').not.toMatch(/border|border-radius|background/)
  })
})

describe('AppSettingsPanel 插槽：只消费内容插槽，不消费 nav/tab', () => {
  it('消费 settingsGroup/<完整分组 key>（Agent / 插件 / 热重载等自绘页靠它接管正文）', () => {
    expect(CODE).toMatch(/ctx\.slots\.occupants\('settingsGroup\/' \+ groupKey\)/)
  })

  it('不消费旧的 settingsNav / settingsTab（统一改名为 settings.nav 之后仍不消费）', () => {
    expect(CODE).not.toMatch(/occupants\('settingsNav'/)
    expect(CODE).not.toMatch(/occupants\('settingsTab'/)
    expect(CODE).not.toMatch(/slots\.register\('settingsNav'/)
    expect(CODE).not.toMatch(/slots\.register\('settingsTab'/)
  })
})
