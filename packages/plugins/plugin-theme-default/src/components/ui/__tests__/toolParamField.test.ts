/**
 * ToolParamField 渲染契约（SSR 拿真实 HTML 断言）。
 *
 * 用户的要求："每一个参数有它的名称描述，指定组件渲染，甚至可以使用自定义组件。"
 * 这条测试逐项锁住：
 * 1. 内置控件按 type 渲染（select / string / number / boolean）；
 * 2. **自定义组件**：给了 param.component 就用它，内置控件不再出现；
 * 3. componentProps 透传给自定义组件；
 * 4. 值以正确类型喂给控件（布尔不能变成字符串 "true"）。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ToolParamDef } from '@mini-canvas/kernel'
import ToolParamField from '../ToolParamField.vue'

/** 渲染一个参数控件；返回值以便自定义组件场景里断言收到的 props */
function render(param: ToolParamDef, modelValue: string | number | boolean = ''): Promise<string> {
  const app = createSSRApp({
    render: () => h(ToolParamField as Component, { param, modelValue, idPrefix: 'tp' }),
  })
  return renderToString(app)
}

describe('内置控件按 type 渲染', () => {
  it('select → 渲染统一 Select 的触发器（而不是原生 select）', async () => {
    const html = await render(
      {
        key: 'thinking',
        label: '思考程度',
        description: '越高越慢但更稳',
        type: 'select',
        default: 'medium',
        options: [
          { label: '低', value: 'low' },
          { label: '中', value: 'medium' },
        ],
      },
      'medium',
    )
    expect(html).toContain('sel-trigger')
    expect(html).not.toContain('<select')
    // 当前值作为标签显示在触发器上
    expect(html).toContain('中')
  })

  it('string → 渲染文本输入，placeholder 用参数的 label', async () => {
    const html = await render({ key: 'suffix', label: '后缀词', type: 'string' }, '')
    expect(html).toContain('type="text"')
    expect(html).toContain('后缀词')
  })

  it('boolean → 渲染开关，且选中态由布尔值驱动（不是字符串 "true"）', async () => {
    const on = await render({ key: 'enhance', label: '提示词增强', type: 'boolean' }, true)
    expect(on).toContain('type="checkbox"')
    expect(on).toContain('checked')

    const off = await render({ key: 'enhance', label: '提示词增强', type: 'boolean' }, false)
    expect(off).not.toContain('checked')
  })

  it('number（有 min/max）→ 走滑块控件', async () => {
    const html = await render({ key: 'steps', label: '步数', type: 'number', min: 1, max: 50 }, 20)
    // PrecisionSlider 的类名/角色即"滑块"形态（不是普通 input）
    expect(html).toMatch(/slider|role="slider"|aria-valuenow/)
  })

  it('number（无 min/max）→ 退化成数字输入', async () => {
    const html = await render({ key: 'seed', label: '随机种子', type: 'number' }, 42)
    expect(html).toContain('type="number"')
  })
})

describe('自定义组件渲染（用户明确要求的能力）', () => {
  it('给了 param.component 就用它渲染，内置控件不再出现', async () => {
    const Custom = {
      name: 'CustomParam',
      props: ['param', 'modelValue', 'disabled'],
      render() {
        // 自定义组件自己决定长什么样（这里用一个可识别的标记）
        return h('div', { 'data-custom-param': 'hit' }, String(this.modelValue))
      },
    }
    const html = await render(
      {
        key: 'thinking',
        label: '思考程度',
        type: 'select',
        options: [{ label: '低', value: 'low' }],
        component: Custom,
      },
      'low',
    )
    expect(html).toContain('data-custom-param="hit"')
    // 内置控件不该同时出现（否则用户会看到两套 UI）
    expect(html).not.toContain('sel-trigger')
    expect(html).not.toContain('<select')
  })

  it('自定义组件能读到 param（名称/描述/选项）与当前值', async () => {
    let seen: { label?: string; description?: string; value?: unknown; options?: number } = {}
    const Custom = {
      name: 'InspectParam',
      props: ['param', 'modelValue'],
      setup(props: { param: ToolParamDef; modelValue: unknown }) {
        seen = {
          label: props.param.label,
          description: props.param.description,
          value: props.modelValue,
          options: props.param.options?.length,
        }
        return () => h('span', 'x')
      },
    }
    await render(
      {
        key: 'style',
        label: '风格',
        description: '画面风格倾向',
        type: 'select',
        options: [
          { label: '写实', value: 'real' },
          { label: '线稿', value: 'line' },
        ],
        component: Custom,
      },
      'line',
    )
    expect(seen.label).toBe('风格')
    expect(seen.description).toBe('画面风格倾向')
    expect(seen.value).toBe('line')
    expect(seen.options).toBe(2)
  })

  it('componentProps 透传给自定义组件（作者需要额外入参时用）', async () => {
    const Custom = {
      name: 'PropBag',
      props: ['param', 'modelValue', 'unit', 'hint'],
      render() {
        return h('div', { 'data-unit': this.unit, 'data-hint': this.hint })
      },
    }
    const html = await render(
      {
        key: 'thinking',
        label: '思考程度',
        component: Custom,
        componentProps: { unit: '档', hint: '自定义提示' },
      },
      'low',
    )
    expect(html).toContain('data-unit="档"')
    expect(html).toContain('data-hint="自定义提示"')
  })

  it('disabled 也传给自定义组件（生成中要能禁用）', async () => {
    let gotDisabled: unknown
    const Custom = {
      name: 'DisabledProbe',
      props: ['param', 'modelValue', 'disabled'],
      setup(props: { disabled?: boolean }) {
        gotDisabled = props.disabled
        return () => h('span', 'x')
      },
    }
    const app = createSSRApp({
      render: () =>
        h(ToolParamField as Component, {
          param: { key: 'k', label: 'K', component: Custom },
          modelValue: 'v',
          disabled: true,
        }),
    })
    await renderToString(app)
    expect(gotDisabled).toBe(true)
  })
})
