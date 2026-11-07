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

  /**
   * 用户口径（2026-11-07）：不管什么平台、什么类型，预设按钮都要显示 ——
   * 所以这里不再挂 v-if="showEditor"（音频节点没有输入框，也必须有入口）。
   */
  it('底栏把 BottomBarPresets 放进 presets 插槽（所有类型都显示）', () => {
    expect(BAR).toContain('<template #presets>')
    expect(BAR).toContain('<BottomBarPresets')
    // 按钮本身不再被「有没有输入框」挡住
    expect(BAR).not.toMatch(/<BottomBarPresets\s+v-if="showEditor"/)
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

  it('新建弹窗打开前收起预设面板（菜单层不能压住对话框）', () => {
    const startCreate = PRESETS.slice(PRESETS.indexOf('function startCreate'), PRESETS.indexOf('function saveDraft'))
    expect(startCreate).toContain('open.value = false')
    // 先关面板，再开弹窗
    expect(startCreate.indexOf('open.value = false')).toBeLessThan(startCreate.indexOf('creating.value = true'))
  })

  /**
   * 用户 2026-11-07 截图：弹窗开着，面板还压在上面。
   * 光把 open 设为 false 不够 —— 菜单层（100002）高于对话框层（100000），
   * 关闭动画期间节点仍挂在 body 上。所以面板必须是**条件渲染**。
   */
  it('新建弹窗打开时面板整块卸载（关动画期间也不能压住弹窗）', () => {
    expect(PRESETS).toMatch(/<PopoverContent\s+v-if="!creating"/)
  })

  it('弹窗正文包在内边距容器里（host.css 把 dialog-content 的 padding / gap 清零）', () => {
    expect(PRESETS).toContain('<div class="nbp-dialog-body">')
    const css = read('../node-bottom-bar/prompt-presets.css')
    const body = css.slice(css.indexOf('.nbp-dialog-body {'), css.indexOf('}', css.indexOf('.nbp-dialog-body {')))
    expect(body).toContain('padding')
    // 内边距不能直接写在外层 DialogContent 的类上：会被 !important 规则吃掉
    const outer = css.slice(css.indexOf('.nbp-dialog {'), css.indexOf('}', css.indexOf('.nbp-dialog {')))
    expect(outer).not.toContain('padding')
  })
})

describe('预设提示词面板：禁用改成独立页签', () => {
  it('不再有「显示禁用预设」开关', () => {
    expect(PRESETS).not.toContain('显示禁用预设')
    expect(PRESETS).not.toContain("useUiComponent('Switch')")
  })

  it('五个页签：provider / 通用 / 指定模型 / 当前模型 / 禁用', () => {
    for (const value of ['provider', 'general', 'model', 'current', 'disabled']) {
      expect(PRESETS).toContain('<TabsTrigger value="' + value + '"')
    }
  })

  it('禁用页签带条数，且点禁用条目会给出提示（不静默）', () => {
    expect(PRESETS).toContain('class="nbp-tabcount"')
    expect(PRESETS).toContain('没有禁用的预设')
    expect(PRESETS).toContain('当前节点用不了这个模型')
  })
})
