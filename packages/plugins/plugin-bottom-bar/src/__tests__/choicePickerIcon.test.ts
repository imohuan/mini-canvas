/**
 * 下拉列表里的图标必须与触发器同源（用户 2026-11-08 截图：触发器有图标、列表全是兜底）。
 *
 * 根因是 Agent 的 ChoicePicker 只按 platform 查品牌图标，没有逐行 icon 的入口。
 * 这里锁住修复后的链路：动作 icon → PickerItem.icon → 行 svg → 面板渲染。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('生成模型下拉：逐行图标', () => {
  it('底栏把每行的 model 图标一起传给选择器', () => {
    const bar = read('NodeBottomBar.vue')
    // actionChoices 必须带上 model，否则下拉只能按标题猜
    expect(bar).toMatch(/note: summary,[\s\S]{0,200}model: o\.model/)
  })

  it('BottomBarChoicePicker 把它映射成 icon', () => {
    const picker = read('node-bottom-bar/BottomBarChoicePicker.vue')
    expect(picker).toContain('icon: o.model')
  })

  it('ChoicePickerMenu 把 icon.svg 透传成行里的 svg', () => {
    const menu = read('node-bottom-bar/ChoicePickerMenu.vue')
    expect(menu).toContain('svg: o.icon.svg')
  })

  it('Agent 的 ChoicePicker 优先用逐行 svg，没给才回落到品牌图标', () => {
    const cp = readFileSync(
      resolve(__dirname, '../../../plugin-agent/src/ui/conversation/ChoicePicker.vue'),
      'utf8',
    )
    // 卡片视图与分栏视图两处都必须走同一层回落
    const hits = cp.match(/item\.svg \|\| brandSvg\(platformOf\(item\)\)/g) ?? []
    expect(hits.length).toBe(2)
  })

  it('预设弹窗里的模型选择器也带图标（不再各自按标题猜）', () => {
    const presets = read('node-bottom-bar/BottomBarPresets.vue')
    expect(presets).toContain('resolveActionIcon')
    expect(presets).toMatch(/icon: o\.icon/)
  })
})
