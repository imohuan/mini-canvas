/**
 * ColorSwatchPicker 的渲染契约。
 *
 * 用户口径 2026-11-15：分组节点的背景颜色要和图片「绘制」模式的标记颜色完全一样。
 * 两边共用这一个件，所以「预置色有哪些、触发器长什么样、有没有自定义取色」只需在这里锁一次。
 */
import { describe, it, expect } from 'vitest'
import { createSSRApp, defineComponent, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { RENDER_CONTEXT_KEY, type CanvasRenderContext } from '@plume-canvas/canvas-render'
import ColorSwatchPicker from '../ColorSwatchPicker.vue'
import { COLOR_SWATCH_PRESETS } from '../colorSwatchPresets'

/** 菜单三件 + 按钮替身：展开态下把面板子树摊平渲染，便于断言色块与自定义入口 */
const Button = defineComponent({
  name: 'StubButton',
  inheritAttrs: false,
  setup(_p, { attrs, slots }) {
    return () => h('button', attrs, slots.default?.())
  },
})
const Popover = defineComponent({
  name: 'StubPopover',
  setup(_p, { slots }) {
    return () => h('div', slots.default?.())
  },
})
const PopoverTrigger = defineComponent({
  name: 'StubPopoverTrigger',
  setup(_p, { slots }) {
    return () => h('div', slots.default?.())
  },
})
const PopoverContent = defineComponent({
  name: 'StubPopoverContent',
  inheritAttrs: false,
  setup(_p, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  },
})
/** 自定义取色器替身：真实实现是 ColorField（第三方 Chrome），这里只验它被挂上 */
const ColorField = defineComponent({
  name: 'StubColorField',
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  setup(props, { attrs }) {
    return () => h('div', { ...attrs, class: 'stub-color-field', 'data-value': props.modelValue })
  },
})

function render(props: Record<string, unknown> = {}): Promise<string> {
  const components: Record<string, Component> = {
    Button,
    Popover,
    PopoverTrigger,
    PopoverContent,
    color: ColorField,
  }
  const ctx = {
    get: () => undefined,
    tryGet: () => undefined,
    registryOf: () => ({
      top: (name: string) => (components[name] ? { value: components[name] } : undefined),
      list: () => [],
      subscribe: () => ({ dispose() {} }),
    }),
  }
  const app = createSSRApp({ render: () => h(ColorSwatchPicker as Component, props) })
  app.provide(RENDER_CONTEXT_KEY, { ctx } as unknown as CanvasRenderContext)
  return renderToString(app)
}

describe('ColorSwatchPicker（分组底色 / 绘制标记色共用）', () => {
  it('预置色表是那张共用的十色表（白/黑 + 八个常用色）', () => {
    expect(COLOR_SWATCH_PRESETS).toEqual([
      '#ffffff',
      '#000000',
      '#ef4444',
      '#f97316',
      '#facc15',
      '#22c55e',
      '#06b6d4',
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
    ])
  })

  it('面板里有「预置颜色」色块与「自定义」取色器（两端完全同款）', async () => {
    const html = await render({ modelValue: '#ef4444', label: '背景颜色' })
    expect(html).toContain('预置颜色')
    expect(html).toContain('自定义')
    // 十个色块都在，且带颜色值与无障碍名
    const dots = html.match(/class="[^"]*csp-dot[^"]*"/g) ?? []
    expect(dots).toHaveLength(COLOR_SWATCH_PRESETS.length)
    for (const c of COLOR_SWATCH_PRESETS) {
      expect(html).toContain(`background-color:${c}`)
      expect(html).toContain(`aria-label="颜色 ${c}"`)
    }
    // 自定义走主题的取色器（带透明度），不是原生 input
    expect(html).toContain('stub-color-field')
    expect(html).not.toContain('type="color"')
  })

  it('当前颜色那个色块被标成选中', async () => {
    const html = await render({ modelValue: '#3b82f6' })
    const active = html.match(/class="[^"]*csp-dot[^"]*is-active[^"]*"/g) ?? []
    expect(active).toHaveLength(1)
    expect(html).toContain('csp-dot is-active')
  })

  it('触发器两种形态：图标态只画色块，文字态是「小圆点 + 文案」', async () => {
    const icon = await render({ modelValue: '#ffffff', label: '标记颜色', trigger: 'icon' })
    expect(icon).toContain('csp-trigger--icon')
    expect(icon).toContain('aria-label="标记颜色"')

    const label = await render({ modelValue: '#334155', label: '背景颜色', trigger: 'label' })
    expect(label).toContain('csp-trigger--label')
    // 文字与 aria-label 同名：可见标签能被读屏念出来
    expect(label).toContain('>背景颜色<')
  })
})
