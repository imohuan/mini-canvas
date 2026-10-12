/**
 * 下拉 / 参数面板与**右键菜单**同款（用户口径 2026-10-12）。
 *
 * 用户原话：「我希望你的这个 plugin-bottom-bar 下拉完全参考 plugin-context-menu 来实现」
 * + 「这里其实不需要使用主题颜色，直接使用默认的黑白两个主题就行，就和你的右键菜单一样，
 *   它里面根本就没有使用到主题颜色，而且也没有必要」。
 *
 * 右键菜单（plugin-context-menu 的 ContextMenu.vue）的数值就是这套契约的唯一来源：
 *   容器 16 圆角 / 6 内边距 / **不透明白底**（--ui-overlay-solid，不写 backdrop-filter）；
 *   行 44 高 / 6 内边距 / 10 圆角 / 行内间距 10 / 0.18s 回弹过渡；
 *   逐项入场 translateY(4px)→0、0.2s、按索引交错 18ms；
 *   选中**不靠颜色**（整张卡没有一处强调色），靠字重与那枚勾；分隔线 1px、上下 5px。
 *
 * 为什么读源码：颜色与尺寸只有浏览器里能量，但「用哪个 token / 有没有写死数值」是源码结构，
 * 可直接断言（与 plugin-context-menu 的 menuOpaque.test.ts 同一手法）。真机观感由浏览器回归核对。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SELECT = readFileSync(new URL('../Select.vue', import.meta.url), 'utf-8')
const DROPDOWN = readFileSync(new URL('../Dropdown.vue', import.meta.url), 'utf-8')
const CATALOG_HOOK = readFileSync(new URL('../useCatalogDropdown.ts', import.meta.url), 'utf-8')
const THEME_CSS = readFileSync(new URL('../../../../../../canvas-render/src/styles/ui-theme.css', import.meta.url), 'utf-8')
const TOOL_RATIO = readFileSync(new URL('../ToolRatioGrid.vue', import.meta.url), 'utf-8')
const TOOL_OPTION = readFileSync(new URL('../ToolOptionGrid.vue', import.meta.url), 'utf-8')
const TOOL_SLIDER = readFileSync(new URL('../ToolParamSlider.vue', import.meta.url), 'utf-8')
const TOOL_GROUP = readFileSync(new URL('../ToolParamGroup.vue', import.meta.url), 'utf-8')

/** 切出某条规则块（取第一个匹配；不做正则转义，见注释里的理由） */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector + ' {')
  if (at === -1) return ''
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close)
}

describe('下拉浮层 = 右键菜单那一档（不透明白底 + 16 圆角 + 6 内边距）', () => {
  it('浮层底色走 --ui-overlay-solid（不是毛玻璃 --ui-glass），且不写 backdrop-filter', () => {
    const body = rule(SELECT, '.sel-menu-body')
    expect(body).toMatch(/--dd-bg:\s*var\(--ui-overlay-solid/)
    expect(body).not.toMatch(/--ui-glass/)
    expect(body).not.toMatch(/backdrop-filter/)
  })

  it('圆角 16、内边距 6 由 --dd-radius / --dd-padding 交给 Dropdown 消费', () => {
    const body = rule(SELECT, '.sel-menu-body')
    expect(body).toMatch(/--dd-radius:\s*16px/)
    expect(body).toMatch(/--dd-padding:\s*6px/)
    // Dropdown 那边必须真读这两个变量（写了没人用等于没写）
    const menu = rule(DROPDOWN, '.dd-menu')
    expect(menu).toMatch(/padding:\s*var\(--dd-padding/)
    expect(menu).toMatch(/border-radius:\s*var\(--dd-radius/)
  })
})

describe('下拉行 = 右键菜单行（44 高 / 6 内边距 / 10 圆角 / 行内 10）', () => {
  const row = rule(SELECT, '.sel-option')

  it('行高 44、内边距 6、圆角 10、行内 gap 10', () => {
    expect(row).toMatch(/min-height:\s*44px/)
    expect(row).toMatch(/padding:\s*6px/)
    expect(row).toMatch(/border-radius:\s*10px/)
    expect(row).toMatch(/gap:\s*10px/)
  })

  it('行之间不留额外空隙（右键菜单也是紧挨着的），过渡走回弹曲线', () => {
    expect(row).not.toMatch(/margin-top/)
    expect(row).toMatch(/transition:[^;]*cubic-bezier\(0\.34,\s*1\.56,\s*0\.64,\s*1\)/)
  })

  it('逐项入场：由 --item-index 驱动的 18ms 交错（与右键菜单同款）', () => {
    expect(row).toMatch(/animation:\s*sel-item-in/)
    expect(row).toMatch(/animation-delay:\s*calc\(var\(--item-index,\s*0\)\s*\*\s*18ms\)/)
    expect(SELECT).toMatch(/@keyframes sel-item-in/)
  })

  it('分组分隔线：相邻选项 group 不同才画一条线（照右键菜单的分块）', () => {
    expect(SELECT).toMatch(/is-group-start/)
    expect(rule(SELECT, '.sel-option.is-group-start')).toMatch(/position:\s*relative/)
    const line = rule(SELECT, ".sel-option.is-group-start::before")
    expect(line).toMatch(/height:\s*1px/)
    expect(line).toMatch(/background:\s*var\(--ui-line/)
  })
})

/**
 * 名称与描述**不许重合**（用户实测反馈 2026-10-12：「你的下拉菜单中标题和描述都重合了，
 * 没有间隔，这需要你修复」）。
 *
 * 根因：.sel-option-label 是 .sel-option-copy 的**绝对定位**子元素，行高若走继承，
 * 13px 正文在 1.5 行高下生成 19.5px 行盒（实测 label 下缘 521 压到描述上缘 519），
 * hover 时「名称上移 + 描述浮出」两行就叠在一起。右键菜单那本（.ctx-menu-label）
 * 本来就写着 line-height: 1，这里补齐同一档。
 *
 * 为什么只能读源码锁：这是"绝对定位 + 行盒高度"的活儿，SSR 量不到；真机观感由浏览器回归核对。
 */
describe('名称/描述不重合（line-height 必须钉在 1）', () => {
  it('名称的行高写死 1（继承宿主行高会让两行叠在一起）', () => {
    const label = rule(SELECT, '.sel-option-label')
    expect(label, '没找到 .sel-option-label 规则').toMatch(/line-height:\s*1\b/)
  })

  it('描述那行同样是 1（两行的行盒都收在自己那一行里）', () => {
    expect(rule(SELECT, '.sel-option-description')).toMatch(/line-height:\s*1\b/)
  })
})

/**
 * 下拉容器走**注册场里登记的那一份**（用户口径 2026-10-12：「你底部下拉菜单可以使用
 * 我插件系统注册的那个组件啊……你直接使用他作为下拉菜单的组件」）。
 *
 * 此前 Select / ToolParamGroup 直接 import 自家的 Dropdown.vue —— 成品应用在注册场里
 * 顶替了 dropdown（ui 包的 AxDropdown），这两处却仍跑主题包这份，注册等于没生效。
 */
describe('下拉容器取注册场里那一份（取不到才回落自带）', () => {
  it('Select 与 ToolParamGroup 都通过 useCatalogDropdown 取件，不再直接 import', () => {
    for (const [name, src] of [
      ['Select.vue', SELECT],
      ['ToolParamGroup.vue', TOOL_GROUP],
    ] as const) {
      expect(src, name + ' 应改用目录取件').toContain("useCatalogDropdown")
      expect(src, name + ' 不该再直接 import 自家 Dropdown').not.toMatch(/import\s+Dropdown\s+from\s+'\.\/Dropdown\.vue'/)
    }
  })

  it('取件钩子：树内走 useUiComponent，树外回落 uiComponentOutside，最后才回落自带件', () => {
    expect(CATALOG_HOOK).toContain("useUiComponent('dropdown')")
    expect(CATALOG_HOOK).toContain("uiComponentOutside('dropdown')")
    expect(CATALOG_HOOK).toMatch(/\?\?\s*\(?ThemeDropdown/)
  })
})

describe('浮层外观 token 收在 ui-theme（两处实现共用同一档数值）', () => {
  it('--dd-padding / --dd-radius / --dd-bg 定义在 ui-theme.css，值与右键菜单一致', () => {
    const vars = rule(THEME_CSS, ':root')
    expect(vars).toMatch(/--dd-padding:\s*6px/)
    expect(vars).toMatch(/--dd-radius:\s*16px/)
    expect(vars).toMatch(/--dd-bg:\s*var\(--ui-overlay-solid\)/)
  })

  it('主题自带件与注册件都读这组 token（加消费方变量也不会漂移）', () => {
    expect(rule(DROPDOWN, '.dd-menu')).toMatch(/var\(--dd-bg/)
    const consumers = [SELECT, TOOL_GROUP]
    for (const src of consumers) {
      expect(src).toMatch(/--dd-padding:\s*6px/)
      expect(src).toMatch(/--dd-radius:\s*16px/)
      expect(src).toMatch(/--dd-bg:\s*var\(--ui-overlay-solid/)
    }
  })
})

describe('不用主题色（黑白两套主题即可）', () => {
  it('下拉：选中行不铺强调色底、勾与箭头都不是强调色', () => {
    const active = rule(SELECT, '.sel-option.is-active')
    expect(active, '选中态不该有背景').not.toMatch(/background/)
    expect(rule(SELECT, '.sel-check')).not.toMatch(/--ui-accent/)
  })

  it('参数网格：选中 = 深色描边 + 浅灰底（描边走 --ui-ink，暗色下自动变近白）', () => {
    const active = rule(TOOL_RATIO, '.trg-cell.is-active')
    expect(active).toMatch(/border-color:\s*var\(--ui-ink/)
    expect(active).toMatch(/background:\s*var\(--ui-hover-soft/)
    expect(active).not.toMatch(/--ui-accent/)
    // 按钮网格（画质/数量这类）同一套口径
    const opt = rule(TOOL_OPTION, '.tog-cell.is-active')
    expect(opt).toMatch(/border-color:\s*var\(--ui-ink/)
    expect(opt).not.toMatch(/--ui-accent/)
  })

  it('参数滑块：轨道/填充/圆球走主按钮那档墨色（亮色近黑、暗色近白），不是强调色', () => {
    expect(TOOL_SLIDER).toMatch(/--ps-accent:\s*var\(--ui-primary-bg/)
    // 参数合并下拉的浮层里也走同一档墨色（浮层内的滑块读不到 .tps-block，得在浮层上定）
    expect(TOOL_GROUP).toMatch(/--ps-accent:\s*var\(--ui-primary-bg/)
    expect(TOOL_GROUP).not.toMatch(/--ps-accent:\s*var\(--ui-accent/)
  })
})

describe('参数面板 = 右键菜单那一档', () => {
  it('容器同样是不透明白底 + 16 圆角；内边距 16（参考稿 p-4）', () => {
    const body = rule(TOOL_GROUP, '.tpg-menu-body')
    expect(body).toMatch(/--dd-bg:\s*var\(--ui-overlay-solid/)
    expect(body).toMatch(/--dd-radius:\s*16px/)
    expect(rule(TOOL_GROUP, '.tpg-menu-body--blocks')).toMatch(/--dd-padding:\s*16px/)
  })

  it('块之间 12 间距 + 一条分割线（参考稿在比例网格与滑块之间就是 border-t）', () => {
    expect(rule(TOOL_GROUP, '.tpg-menu--blocks')).toMatch(/gap:\s*12px/)
    const divider = rule(TOOL_GROUP, '.tpg-menu--blocks .tpg-block + .tpg-block')
    expect(divider).toMatch(/border-top:\s*1px solid/)
    expect(divider).toMatch(/padding-top:\s*12px/)
  })

  it('面板宽 288（参考稿 w-72）', () => {
    expect(TOOL_GROUP).toMatch(/'288px'/)
  })
})

