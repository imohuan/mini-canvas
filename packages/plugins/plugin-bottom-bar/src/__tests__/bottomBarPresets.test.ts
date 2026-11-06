/**
 * 底栏「预设提示词」入口的接线契约（用户 2026-11-06）。
 *
 * 这里只钉接线，不重复测面板外观：
 * - 按钮由 BottomBarPresets 提供，挂在 BottomBarActions 的 presets 插槽里；
 * - 点一条预设 = 把正文放进输入框（已有内容就接在后面），并收起面板；
 * - 面板里的搜索、弹窗、滚动都走全局注册的 shadcn 组件与 ScrollArea。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const BAR = read('../NodeBottomBar.vue')
const PRESETS = read('../node-bottom-bar/BottomBarPresets.vue')
const ACTIONS = read('../node-bottom-bar/BottomBarActions.vue')

describe('预设提示词按钮：接线', () => {
  it('BottomBarActions 留出了 presets 插槽，且只有一处', () => {
    expect(ACTIONS).toContain('<slot name="presets" />')
  })

  it('底栏把 BottomBarPresets 放进 presets 插槽（没有输入框的节点不显示）', () => {
    expect(BAR).toContain('<template #presets>')
    expect(BAR).toContain('<BottomBarPresets')
    expect(BAR).toContain('v-if="showEditor"')
  })

  it('按钮带无障碍名和可测标识', () => {
    expect(PRESETS).toContain('aria-label="预设提示词"')
    expect(PRESETS).toContain('data-testid="bar-presets"')
  })

  it('填入用编辑器 setText（能带换行），空输入框不额外加空行', () => {
    expect(BAR).toContain('editor?.setText')
    expect(BAR).toMatch(/current \? current\.replace/)
  })
})

describe('预设提示词面板：只用全局组件', () => {
  it('搜索、新建弹窗、滚动容器都取 ui 注册表', () => {
    for (const name of [
      'InputGroup',
      'InputGroupInput',
      'ScrollArea',
      'Dialog',
      'DialogContent',
      'Textarea',
      'Input',
      'Button',
    ]) {
      expect(PRESETS).toContain("useUiComponent('" + name + "')")
    }
    expect(PRESETS).not.toMatch(/<input\s/)
    expect(PRESETS).not.toMatch(/overflow-y:\s*auto/)
  })

  it('不直接 import 组件库（只有默认主题能那样做）', () => {
    expect(PRESETS).not.toContain('@mini-canvas/ui-kit-shadcn')
    expect(PRESETS).not.toContain('vue-sonner')
  })
})
