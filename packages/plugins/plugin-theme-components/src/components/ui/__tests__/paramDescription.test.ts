/**
 * 参数说明的渲染契约（用户 2026-11-09：「参数应该还需要提供描述，比如这个参数是做什么的，
 * 前端 UI 也需要渲染出来」）。
 *
 * 四种去处，各有理由（别再统一塞成一种，会互相打架）：
 * 1. 下拉：写进**展开后的列表顶部**并钉住。触发器只有 32px 高，
 *    塞一行说明会把当前值「模型 B」挤成省略号；
 * 2. 按钮网格 / 比例网格 / 滑块：自己画标题，说明紧跟标题（2px），整团再与控件隔 8；
 * 3. 文本 / 数字 / 开关：自己没标题，说明跟在控件下面一行；
 * 4. 自定义组件：不拦，作者自己决定（说明随 `param` 一起给了它）。
 *
 * 还有一条必须守住：**同一句说明不能出现两遍**。
 * ToolParamGroup 画了标题和说明，于是它给 ToolParamField 传 `hide-hint`。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ToolParamDef } from '@mini-canvas/kernel'
import ToolParamField from '../ToolParamField.vue'
import ToolOptionGrid from '../ToolOptionGrid.vue'
import ToolParamSlider from '../ToolParamSlider.vue'
import ToolParamHint from '../ToolParamHint.vue'

function renderField(param: ToolParamDef, extra: Record<string, unknown> = {}): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () => h(ToolParamField as Component, { param, modelValue: '', idPrefix: 'tp', ...extra }),
    }),
  )
}

const HINT = '决定输出的画面比例，影响构图与裁切'

describe('说明行只带走自己的那一份', () => {
  it('ToolParamHint：空串 / 纯空格不渲染任何东西', async () => {
    const empty = await renderToString(
      createSSRApp({ render: () => h(ToolParamHint as Component, { text: '   ' }) }),
    )
    // v-if 不成立时只有一个注释占位，没有 <p> 也不会有文字
    expect(empty).not.toContain('<p')
  })

  it('ToolParamHint：文字原样输出，标签是 p（块级，能折行）', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(ToolParamHint as Component, { text: HINT }) }),
    )
    expect(html).toContain('<p')
    expect(html).toContain(HINT)
  })
})

describe('下拉：说明在展开后的列表里，不在触发器上', () => {
  /*
   * 下拉的选项区经 Teleport 送到 body，SSR 输出里看不到 ——
   * 这一段的行为在 paramDescription.dom.test.ts 里用 happy-dom 真点开验。
   * 这里只锁「触发器上不该有说明」这条，免得有人又把它塞回 32px 那一行。
   */
  it('触发器上不带说明（长说明会把当前值挤成省略号）', async () => {
    const html = await renderField({
      key: 'ratio',
      label: '比例',
      description: HINT,
      type: 'select',
      options: [{ label: '16:9', value: '16:9' }],
    })
    const trigger = html.slice(html.indexOf('data-slot="select-trigger"'), html.indexOf('</button>'))
    expect(trigger).not.toContain(HINT)
  })

  it('传了 hide-hint 就不再画（调用方已经画过）', async () => {
    const html = await renderField(
      {
        key: 'ratio',
        label: '比例',
        description: HINT,
        type: 'select',
        options: [{ label: '16:9', value: '16:9' }],
      },
      { hideHint: true },
    )
    expect(html).not.toContain(HINT)
  })
})

describe('自己画标题的控件：说明紧跟在标题下', () => {
  it('按钮网格把标题与说明包成一团', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(ToolOptionGrid as Component, {
            param: { key: 'q', label: '画质', description: HINT, type: 'grid', options: [] },
          }),
      }),
    )
    expect(html).toContain('tog-head')
    expect(html).toContain(HINT)
  })

  it('滑块被 hideTitle 时不自己画说明（说明归调用方，避免两遍）', async () => {
    const param = { key: 'd', label: '时长', description: HINT, type: 'number', min: 1, max: 10 }
    const withTitle = await renderToString(
      createSSRApp({ render: () => h(ToolParamSlider as Component, { param, modelValue: 3 }) }),
    )
    expect(withTitle).toContain(HINT)

    const noTitle = await renderToString(
      createSSRApp({
        render: () => h(ToolParamSlider as Component, { param, modelValue: 3, hideTitle: true }),
      }),
    )
    expect(noTitle).not.toContain(HINT)
  })
})

describe('没有标题的控件：说明跟在控件下面', () => {
  it('文本输入框下面有一行说明', async () => {
    const html = await renderField({ key: 'suffix', label: '后缀', description: HINT, type: 'string' })
    expect(html).toContain('type="text"')
    expect(html).toContain(HINT)
  })

  it('开关下面有一行说明', async () => {
    const html = await renderField({ key: 'on', label: '开关', description: HINT, type: 'boolean' })
    expect(html).toContain('role="switch"')
    expect(html).toContain(HINT)
  })

  it('没写 description 时一行都不多出来', async () => {
    const html = await renderField({ key: 'suffix', label: '后缀', type: 'string' })
    expect(html).not.toContain('tph-hint')
  })
})
