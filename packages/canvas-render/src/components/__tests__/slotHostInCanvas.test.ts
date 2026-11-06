/**
 * 画布内 overlay 槽（真机回归，2026-11-05：对齐参考线插件"没有效果"）。
 *
 * 场景差异：外壳槽由外壳渲染时，树上有应用级上下文（CANVAS_CONTEXT_KEY）；
 * 而画布内的 overlay 槽住在 CanvasSurface 里，那里 provide 的是**渲染上下文**
 * （RENDER_CONTEXT_KEY）——SlotHost 若只读应用级上下文，在画布内就取不到 slot 列表，
 * 于是 overlay occupant（参考线浮层）永远不渲染。
 *
 * 这层用真实 Context + 两种 provide 组合直接对照。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h, type InjectionKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import { CANVAS_CONTEXT_KEY } from '@mini-canvas/vue-render/context'
import SlotHost from '@mini-canvas/vue-render/SlotHost.vue'

const RENDER_KEY: InjectionKey<{ ctx: Context }> = Symbol.for('canvas-v2-render-context') as never

function occupant() {
  return defineComponent({ render: () => h('div', { 'data-guide': '1' }, 'guide') })
}

describe('SlotHost 在画布内也能渲染 overlay', () => {
  it('只有应用级上下文时能渲染（外壳场景，既有能力）', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('overlay', { id: 'guide', component: occupant() })
    const app = createSSRApp({ render: () => h(SlotHost, { slot: 'overlay' }) })
    app.provide(CANVAS_CONTEXT_KEY, { ctx })
    const html = await renderToString(app)
    expect(html).toContain('data-guide')
    ctx.stop()
  })

  it('只有渲染上下文时也必须能渲染（画布 CanvasSurface 场景）', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('overlay', { id: 'guide', component: occupant() })
    const app = createSSRApp({ render: () => h(SlotHost, { slot: 'overlay' }) })
    // 画布内只 provide 渲染上下文（没有应用级 key）
    app.provide(RENDER_KEY, { ctx })
    const html = await renderToString(app)
    expect(html).toContain('data-guide')
    ctx.stop()
  })
})
