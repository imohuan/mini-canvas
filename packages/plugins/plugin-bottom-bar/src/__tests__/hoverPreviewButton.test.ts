/**
 * hover 预览里的「全屏」按钮（用户 2026-11-06）。
 *
 * 用户原话：「圆形图标按钮、小尺寸、不要提供任何 UI 样式，使用默认的 UI，类型用 ghost」。
 * 所以这里钉住：ghost + icon-xs + 图标（不再是一颗写着「全屏」的文字按钮），
 * 底栏样式只许摆位置，形状/底色/悬停交给组件库。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const SFC = readFileSync(fileURLToPath(new URL('../node-bottom-bar/BottomBarHoverPreview.vue', import.meta.url)), 'utf8')
const CSS = readBottomBarCss()

describe('hover 预览的全屏按钮：默认组件样式', () => {
  it('ghost + 小号图标按钮，里面是图标不是文字', () => {
    expect(SFC).toContain('<Button variant="ghost" size="icon-xs"')
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

  it('圆形：只把圆角钉成胶囊，避免被主题的方角档位带偏', () => {
    const i = CSS.indexOf('.nb-hover-preview-open {')
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).toMatch(/border-radius\s*:\s*999px/)
  })
})
