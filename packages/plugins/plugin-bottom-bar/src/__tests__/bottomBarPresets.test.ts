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
    expect(PRESETS).not.toContain('@plume-canvas/ui-kit-shadcn')
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

  /**
   * 用户 2026-11-07：切换页签时面板高度跳来跳去。
   * 列表高度必须是常数（不读 filtered.length），条目多时靠内部滚动。
   */
  it('列表高度固定，不跟条数缩放', () => {
    const script = PRESETS.slice(0, PRESETS.indexOf('</script>'))
    const m = script.match(/const LIST_HEIGHT = '([0-9]+)px'/)
    expect(m).not.toBeNull()
    // 高度计算里不允许再出现 filtered / 条数
    expect(script).not.toMatch(/Math\.max\(1,\s*filtered/)
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
  /**
   * 旧的「显示禁用预设」开关已删除（改成独立页签）。
   * 2026-11-09 又引入了一个 Switch —— 用来选「追加 / 替换」，与禁用无关。
   */
  it('不再有「显示禁用预设」开关', () => {
    expect(PRESETS).not.toContain('显示禁用预设')
  })

  it('五个页签：provider / 通用 / 指定模型 / 当前模型 / 禁用', () => {
    for (const value of ['provider', 'general', 'model', 'current', 'disabled']) {
      expect(PRESETS).toContain('value="' + value + '"')
    }
  })

  /**
   * 用户 2026-11-07：页签要用中文；没有 provider 模板 / 没有禁用预设时，
   * 对应页签不渲染，别给用户一个点了是空的页签。
   */
  it('页签中文化，provider / 禁用页签按内容显隐', () => {
    expect(PRESETS).toContain('>平台模板</TabsTrigger>')
    expect(PRESETS).not.toMatch(/<TabsTrigger value="provider">Provider</)
    expect(PRESETS).toMatch(/<TabsTrigger v-if="hasProviderTab" value="provider"/)
    expect(PRESETS).toMatch(/<TabsTrigger v-if="hasDisabledTab" value="disabled"/)
    // 隐藏页签正被激活时退回「当前模型」
    expect(PRESETS).toMatch(/tab.value === 'provider' && !hasProviderTab.value/)
    expect(PRESETS).toMatch(/tab.value === 'disabled' && !hasDisabledTab.value/)
  })

  /**
   * 用户 2026-11-07 第二轮：弹窗里的「适用模型」要的是底栏那个**卡片/分栏面板**
   * （Agent 的 ChoicePicker），不是简单菜单。第三轮：两个地方必须**共用同一个组件**
   * ChoicePickerMenu，UI 只有实现一份。
   */
  it('适用模型与底栏共用 ChoicePickerMenu 组件', () => {
    const SHARED = read('../node-bottom-bar/ChoicePickerMenu.vue')
    const CHOICE = read('../node-bottom-bar/BottomBarChoicePicker.vue')
    // 共用组件就是 Agent 的 ChoicePicker + 触发器的唯一实现
    expect(SHARED).toContain("useUiComponent('agentChoicePicker')")
    expect(SHARED).toContain('nb-agent-choice-menu')
    // 弹窗和底栏都只是传数据，不再自摆 UI
    expect(PRESETS).toContain('<ChoicePickerMenu')
    expect(PRESETS).toContain(':in-dialog="true"')
    expect(CHOICE).toContain('<ChoicePickerMenu')
    // 弹窗里不再直接摸 DropdownMenu / AgentChoicePicker
    expect(PRESETS).not.toContain("useUiComponent('agentChoicePicker')")
    expect(PRESETS).not.toContain("useUiComponent('DropdownMenu')")
  })

  it('禁用页签带条数，且点禁用条目会给出提示（不静默）', () => {
    expect(PRESETS).toContain('class="nbp-tabcount"')
    expect(PRESETS).toContain('没有禁用的预设')
    expect(PRESETS).toContain('当前节点用不了这个模型')
  })

  /**
   * 用户 2026-11-09 的三点：① 预设要能编辑；② 应用方式可选追加 / 替换；
   * ③ 参数触发器不能溢出容器。
   */
  it('预设可编辑（复用弹窗，就地覆盖）', () => {
    expect(PRESETS).toContain('function startEdit')
    expect(PRESETS).toContain('class="nbp-edit"')
    // provider 自带的不给编辑入口
    expect(PRESETS).toContain('平台模板不能编辑')
  })

  it('应用方式可选追加 / 替换，并随预设保存', () => {
    expect(PRESETS).toContain('draftApplyMode')
    expect(PRESETS).toContain('替换输入框内容')
    expect(PRESETS).toContain('applyMode: draftApplyMode.value')
    // 纯提示词分发时带上模式
    expect(PRESETS).toContain("emit('apply', preset.content, preset.applyMode")
  })

  it('参数触发器限制在容器内（长摘要不溢出）', () => {
    const css = read('../node-bottom-bar/prompt-presets.css')
    const bh = css.indexOf('.nbp-dialog .nb-param-trigger {')
    const body = css.slice(bh, css.indexOf('}', bh))
    expect(body).toContain('max-width: 100%')
    expect(body).toContain('min-width: 0')
    const txt = css.indexOf('.nbp-dialog .nb-param-text {')
    const txtBody = css.slice(txt, css.indexOf('}', txt))
    expect(txtBody).toContain('max-width: 100%')
    expect(txtBody).toContain('text-overflow: ellipsis')
  })

  /**
   * 用户 2026-11-09：切到「平台模板」页签时面板变宽 —— 条目里的长标签把容器撑开了。
   * 契约：面板宽度固定（不再 max-content），条目与标签都必须能省略。
   */
  it('面板宽度固定，切页签不变宽（长标签省略而不是撑开）', () => {
    const css = read('../node-bottom-bar/prompt-presets.css')
    const pop = css.slice(css.indexOf('.nbp-pop {'), css.indexOf('}', css.indexOf('.nbp-pop {')))
    // 固定 width，不再是 max-content（只查声明行，注释里提到过这个词不算）
    const decls = pop.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    expect(decls.join('\n')).not.toContain('max-content')
    expect(pop).toContain('width: min(380px')

    const item = css.slice(css.indexOf('.nbp-item {'), css.indexOf('}', css.indexOf('.nbp-item {')))
    expect(item).toContain('min-width: 0')

    const name = css.slice(css.indexOf('.nbp-item-name {'), css.indexOf('}', css.indexOf('.nbp-item-name {')))
    expect(name).toContain('min-width: 0')
    expect(name).toContain('text-overflow: ellipsis')

    const tag = css.slice(css.indexOf('.nbp-tag {'), css.indexOf('}', css.indexOf('.nbp-tag {')))
    expect(tag).toContain('max-width')
    expect(tag).toContain('text-overflow: ellipsis')
  })
})
