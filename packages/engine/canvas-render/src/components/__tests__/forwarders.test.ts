/**
 * 转发件回归：canvas-render 里的 SlotComposer / SlotAnchor 现在只是转发，
 * 实现住在 @plume-canvas/vue-render。这里跑一次真实渲染，证明转发链（.vue 转发）没断。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@plume-canvas/canvas-data'
import { CANVAS_CONTEXT_KEY } from '@plume-canvas/vue-render'
import { SlotComposer, SlotAnchor } from '../../index'

describe('canvas-render 转发件', () => {
  it('SlotComposer / SlotAnchor 从旧路径可用，且与 vue-render 是同一个组件', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('shell.dock', {
      id: 'plugin/x',
      order: 900,
      before: 'host/agent',
      component: defineComponent({ render: () => h('i', { 'data-plugin': 'x' }, 'X') }),
    })

    const app = createSSRApp({
      render: () =>
        h(SlotComposer, { slot: 'shell.dock' }, () => [
          h(SlotAnchor, { id: 'host/add', order: 100 }, () => h('i', { 'data-host': 'add' }, 'A')),
          h(SlotAnchor, { id: 'host/agent', order: 800 }, () => h('i', { 'data-host': 'agent' }, 'B')),
        ]),
    })
    app.provide(CANVAS_CONTEXT_KEY, { ctx })
    const html = await renderToString(app)

    const at = ['data-host="add"', 'data-plugin="x"', 'data-host="agent"'].map((k) => html.indexOf(k))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect(at[0]).toBeLessThan(at[1]!)
    expect(at[1]).toBeLessThan(at[2]!)
    ctx.stop()
  })
})
