/**
 * 下拉 / 参数面板与**右键菜单**同款（用户口径 2026-10-12）。
 *
 * 实现已经全部换成 @mini-canvas/ui-kit-shadcn 的分离件，所以这里不再读旧组件的源码，
 * 只锁住主题自己那层的外观 token 与「参数面板仍然是右键菜单那一档」的尺寸。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const THEME_CSS = readFileSync(new URL('../../../../../../canvas-render/src/styles/ui-theme.css', import.meta.url), 'utf-8')
const TOOL_RATIO = readFileSync(new URL('../ToolRatioGrid.vue', import.meta.url), 'utf-8')
const TOOL_OPTION = readFileSync(new URL('../ToolOptionGrid.vue', import.meta.url), 'utf-8')
const TOOL_SLIDER = readFileSync(new URL('../ToolParamSlider.vue', import.meta.url), 'utf-8')
const TOOL_GROUP = readFileSync(new URL('../ToolParamGroup.vue', import.meta.url), 'utf-8')
const COLOR_FIELD = readFileSync(new URL('../ColorField.vue', import.meta.url), 'utf-8')

/** 切出某条规则块（取第一个匹配；不做正则转义，见注释里的理由） */
function rule(css: string, selector: string): string {
  const at = css.indexOf(selector + ' {')
  if (at === -1) return ''
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return open === -1 || close === -1 ? '' : css.slice(open + 1, close)
}

describe('浮层外观 token 收在 ui-theme（所有下拉共用同一档数值）', () => {
  it('--dd-padding / --dd-radius / --dd-bg 定义在 ui-theme.css，值与右键菜单一致', () => {
    const vars = rule(THEME_CSS, ':root')
    expect(vars).toMatch(/--dd-padding:\s*6px/)
    expect(vars).toMatch(/--dd-radius:\s*var\(--mct-radius,\s*16px\)/)
    expect(vars).toMatch(/--dd-bg:\s*var\(--ui-overlay-solid\)/)
  })
})

describe('参数面板 = 右键菜单那一档', () => {
  it('容器同样是不透明白底 + 主题圆角；内边距 16（参考稿 p-4）', () => {
    const body = rule(TOOL_GROUP, '.tpg-popover')
    expect(body).toMatch(/background:\s*var\(--ui-overlay-solid/)
    expect(body).toMatch(/border-radius:\s*var\(--mct-radius,\s*16px\)/)
    expect(body).toMatch(/padding:\s*16px/)
    // 宽度不再写死 288（用户口径 2026-11-03「宽度没有自适应」）：随内容走，
    // 只用上下限兜住极端情况。
    expect(body).toMatch(/width:\s*max-content/)
    expect(body).toMatch(/min-width:\s*220px/)
    expect(body).toMatch(/max-width:\s*min\(420px/)
  })

  it('块之间 12 间距 + 一条分割线（参考稿在比例网格与滑块之间就是 border-t）', () => {
    expect(rule(TOOL_GROUP, '.tpg-menu--blocks')).toMatch(/gap:\s*12px/)
    const divider = rule(TOOL_GROUP, '.tpg-menu--blocks .tpg-block + .tpg-block')
    expect(divider).toMatch(/border-top:\s*1px solid/)
    expect(divider).toMatch(/padding-top:\s*12px/)
  })

  it('每个参数都竖排成块：块内 8 间距的纵向 flex（标题一行、控件一行）', () => {
    const block = rule(TOOL_GROUP, '.tpg-menu--blocks .tpg-block')
    expect(block).toMatch(/flex-direction:\s*column/)
    expect(block).toMatch(/gap:\s*8px/)
    expect(TOOL_GROUP).not.toMatch(/\.tpg-row\b/)
    expect(TOOL_GROUP).not.toMatch(/\.tpg-label\b/)
  })

  it('非预设件的标题与预设件自己的 h4 同档（12px / 700 / 20 行高）', () => {
    const title = rule(TOOL_GROUP, '.tpg-menu--blocks .tpg-title')
    expect(title).toMatch(/font-size:\s*12px/)
    expect(title).toMatch(/font-weight:\s*700/)
    expect(title).toMatch(/line-height:\s*20px/)
  })
})

describe('不用主题色（黑白两套主题即可）', () => {
  it('参数网格：选中 = 深色描边 + 浅灰底（描边走 --ui-ink，暗色下自动变近白）', () => {
    const active = rule(TOOL_RATIO, '.trg-cell.is-active')
    expect(active).toMatch(/border-color:\s*var\(--ui-ink/)
    expect(active).toMatch(/background:\s*var\(--ui-hover-soft/)
    expect(active).not.toMatch(/--ui-accent/)
    const opt = rule(TOOL_OPTION, '.tog-cell.is-active')
    expect(opt).toMatch(/border-color:\s*var\(--ui-ink/)
    expect(opt).not.toMatch(/--ui-accent/)
  })

  it('参数滑块：轨道/填充/圆球走主按钮那档墨色（亮色近黑、暗色近白），不是强调色', () => {
    expect(TOOL_SLIDER).toMatch(/--ps-accent:\s*var\(--ui-primary-bg/)
    expect(TOOL_GROUP).toMatch(/--ps-accent:\s*var\(--ui-primary-bg/)
    expect(TOOL_GROUP).not.toMatch(/--ps-accent:\s*var\(--ui-accent/)
  })

  it('取色浮层走 shadcn Popover，不再自己画下拉外壳', () => {
    expect(COLOR_FIELD).toMatch(/PopoverContent/)
    expect(COLOR_FIELD).not.toMatch(/@mini-canvas\/ui-kit['"]/)
  })
})
