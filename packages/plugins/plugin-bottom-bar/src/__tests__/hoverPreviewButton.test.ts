/**
 * hover 预览里的「全屏」按钮（用户 2026-11-07）。
 *
 * 用户原话：「类型为 secondary 按钮使用 icon-xs，添加 class=rounded-full」，
 * 且不要自己写 UI 样式。所以这里钉住：secondary + icon-xs + rounded-full + 图标，
 * 底栏样式只许摆位置，形状/底色/悬停交给组件库。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const SFC = readFileSync(fileURLToPath(new URL('../node-bottom-bar/BottomBarHoverPreview.vue', import.meta.url)), 'utf8')
const CSS = readBottomBarCss()

describe('hover 预览的全屏按钮：默认组件样式', () => {
  it('secondary + icon-xs + rounded-full，里面是图标不是文字', () => {
    expect(SFC).toContain('<Button variant="secondary" size="icon-xs"')
    expect(SFC).toContain('rounded-full')
    expect(SFC).not.toContain('>全屏</Button>')
    expect(SFC).toContain('v-html="ICON_EXPAND"')
  })

  it('底栏样式只给位置，不覆盖底色 / 字色 / 圆角 / 字号', () => {
    const i = CSS.indexOf('.nb-hover-preview-open {')
    expect(i).toBeGreaterThan(-1)
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).toMatch(/position\s*:\s*absolute/)
    for (const prop of ['background', 'color', 'font-size', 'font-weight']) {
      expect(block, '.nb-hover-preview-open 不该写 ' + prop).not.toMatch(new RegExp('(^|[;\\s])' + prop + '\\s*:'))
    }
  })

  it('圆形由 rounded-full 负责，底栏样式不写圆角', () => {
    const i = CSS.indexOf('.nb-hover-preview-open {')
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).not.toMatch(/border-radius/)
  })

  it('压在明亮画面上也要看得见：给一层媒体衬底', () => {
    const i = CSS.indexOf('.nb-hover-preview-open {')
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).toMatch(/background-color:\s*color-mix\(/)
  })

  it('宿主那条无层 [data-slot=button] 圆角会压掉 rounded-full，需单独补一条同层规则', () => {
    expect(CSS).toMatch(/\[data-slot='button'\]\.nb-hover-preview-open\.rounded-full\s*\{\s*border-radius:\s*9999px/)
  })
})
