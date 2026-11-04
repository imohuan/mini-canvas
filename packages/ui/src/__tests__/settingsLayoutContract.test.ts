/**
 * 设置正文居中与浮动窗拖拽角（用户口径 2026-11-03）。
 * 两套设置皮必须同步：正文卡片组整体居中，卡片内文字仍左对齐；
 * 拖拽图标内缩，命中区不缩小。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf-8')

const appContent = read('../components/settings/settings/SettingsContent.vue')
const themeContent = read(
  '../../../plugins/plugin-theme-default/src/components/settings/settings/SettingsContent.vue',
)
const shell = read('../../../canvas-render/src/components/SettingsShell.vue')

describe('设置正文：固定最大宽度、整体居中', () => {
  it('两套设置皮都在正文容器里用水平居中', () => {
    for (const [name, src] of [['asp', appContent], ['psd', themeContent]] as const) {
      const body = new RegExp('\\.' + name + '-body\\s*\\{([^}]*)\\}').exec(src)?.[1] ?? ''
      expect(body, name + ' 缺正文布局').toMatch(/display:\s*flex/)
      expect(body, name + ' 没有 flex-direction: column').toMatch(/flex-direction:\s*column/)
      const section = new RegExp('\\.' + name + '-section\\s*\\{([^}]*)\\}').exec(src)?.[1] ?? ''
      expect(section, name + ' 卡片没有 max-width').toMatch(/max-width:\s*760px/)
      expect(section, name + ' 卡片没有水平居中').toMatch(/margin-inline:\s*auto/)
    }
  })

  it('宽版自绘页仍贴齐正文，不被居中规则缩窄', () => {
    expect(appContent).toMatch(/\.asp-section-page\.is-wide\s*\{[^}]*margin-inline:\s*0/)
    expect(themeContent).toMatch(/\.psd-section-page\.is-wide\s*\{[^}]*margin-inline:\s*0/)
  })
})

describe('浮动窗拖拽角：图标内缩、命中区不缩小', () => {
  it('图标离右下角有内缩，面板圆角完整', () => {
    const rule = /\.psd-resize-handle\s*\{([^}]*)\}/.exec(shell)?.[1] ?? ''
    expect(rule, '缺拖拽角规则').not.toBe('')
    expect(rule).toMatch(/right:\s*2px/)
    expect(rule).toMatch(/bottom:\s*2px/)
    expect(rule).toMatch(/width:\s*20px/)
    expect(rule).toMatch(/height:\s*20px/)
    expect(rule).not.toMatch(/right:\s*0/)
    expect(rule).not.toMatch(/bottom:\s*0/)
  })

  it('拖拽行为没被改动：仍是 mousedown 进入 resize', () => {
    expect(shell).toMatch(/@mousedown="onResizeMouseDown"/)
  })
})
