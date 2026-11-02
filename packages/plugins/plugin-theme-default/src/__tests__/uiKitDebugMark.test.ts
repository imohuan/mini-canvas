/**
 * 按名登记的组件也要能显示「组件库使用标记」。
 *
 * 用户口径（2026-11-02）：模板里直写的 shadcn 组件有圆点，但插件按名从目录取到的
 * （`<component :is="...">`）没有任何标记 —— 那一类必须由「登记时包一层」补上。
 * 这一层要求**完全透明**：props / slots / attrs / 事件都原样到原组件。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import {
  UI_KIT_DEBUG_ATTR,
  UI_KIT_DEBUG_COMPONENT_ATTR,
  withUiKitDebugMark,
} from '@mini-canvas/ui-kit-shadcn'
import { Button } from '@mini-canvas/ui-kit-shadcn'

const Probe = defineComponent({
  name: 'Probe',
  props: { label: { type: String, default: '' } },
  setup(props, { slots }) {
    return () =>
      h('div', { class: 'probe', 'data-label': props.label },
        slots.default?.(),
      )
  },
})

describe('withUiKitDebugMark：按名登记组件的透明标记层', () => {
  it('props / slots / class 原样转发，并带上定位属性', async () => {
    const Wrapped = withUiKitDebugMark(Probe, 'packages/demo/src/index.ts', 'Probe')
    const app = createSSRApp({
      render: () =>
        h(Wrapped, { label: '你好', class: 'outer' }, {
          default: () => h('b', { class: 'inner' }, '插槽内容'),
        }),
    })
    const html = await renderToString(app)

    expect(html).toContain('data-label="你好"')
    expect(html).toContain('outer')
    expect(html).toContain('插槽内容')
    expect(html).toContain(`${UI_KIT_DEBUG_ATTR}="packages/demo/src/index.ts"`)
    expect(html).toContain(`${UI_KIT_DEBUG_COMPONENT_ATTR}="Probe"`)
  })

  /** 真组件也要落在 DOM 根上：shadcn Button 的根是 <button>，标记要出现在它身上 */
  it('包真实的 shadcn Button：标记落在按钮根元素，class / 插槽不变', async () => {
    const Wrapped = withUiKitDebugMark(Button, 'packages/demo/src/index.ts', 'Button')
    const app = createSSRApp({
      render: () => h(Wrapped, { class: 'my-btn' }, { default: () => '发送' }),
    })
    const html = await renderToString(app)

    expect(html).toMatch(/<button[^>]*data-ui-kit-debug="packages\/demo\/src\/index.ts"/)
    expect(html).toContain('my-btn')
    expect(html).toContain('发送')
  })
})

