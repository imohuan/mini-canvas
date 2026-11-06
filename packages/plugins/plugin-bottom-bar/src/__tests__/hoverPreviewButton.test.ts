/**
 * hover 预览里的「全屏」按钮（用户 2026-11-06）。
 *
 * 用户原话：「请使用默认的组件样式就行，不要自己添加任何 UI 样式」。
 * 之前底栏给这个按钮写死了半透明黑底 + 圆角 + 白字，把组件库默认外观盖掉了，
 * 深色画布上按钮像不存在。这里钉住：只许摆位置，外观交给 Button。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const SFC = readFileSync(fileURLToPath(new URL('../node-bottom-bar/BottomBarHoverPreview.vue', import.meta.url)), 'utf8')
const CSS = readBottomBarCss()

describe('hover 预览的全屏按钮：默认组件样式', () => {
  it('用组件库的 Button，且不传 ghost 这类会吃掉底色的变体', () => {
    expect(SFC).toContain('<Button variant="default"')
    expect(SFC).not.toContain('variant="ghost" size="sm"')
  })

  it('底栏样式只给位置，不覆盖底色 / 字色 / 圆角 / 字号', () => {
    const i = CSS.indexOf('.nb-hover-preview-open {')
    expect(i).toBeGreaterThan(-1)
    const block = CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
    expect(block).toMatch(/position\s*:\s*absolute/)
    for (const prop of ['background', 'color', 'border-radius', 'font-size', 'font-weight']) {
      expect(block, '.nb-hover-preview-open 不该写 ' + prop).not.toMatch(new RegExp('(^|[;\\s])' + prop + '\\s*:'))
    }
  })
})
