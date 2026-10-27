/**
 * SlotHost 在外壳里可用。
 *
 * 以前 SlotHost 绑死 useCanvasRender()，只能活在 CanvasHost 子树里；
 * 外壳（抽屉/状态条/底栏）需要一个只依赖基础上下文的版本。
 * 这里锁：只 provide CANVAS_CONTEXT_KEY，也能渲染外壳槽。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import type { CanvasHostHandle, MiniCanvasApi } from '../../host/createMiniCanvasHost'
import type { PluginManager } from '../../host/pluginManager'
import { CANVAS_CONTEXT_KEY, type CanvasContext } from '../../contracts/canvasContext'
import SlotHost from '../SlotHost.vue'

function baseContext(ctx: Context): CanvasContext {
  return {
    ctx,
    host: {} as CanvasHostHandle,
    api: {} as MiniCanvasApi,
    manager: {} as PluginManager,
  }
}

describe('SlotHost 使用基础上下文', () => {
  it('Provider 内可渲染外壳槽', async () => {
    const ctx = new Context()
    await ctx.start()
    ctx.slots.register('shell.dock.end', {
      id: 'demo',
      component: defineComponent({ render: () => h('button', { 'data-demo': '1' }, '扩展') }),
    })
    const app = createSSRApp({ render: () => h(SlotHost, { slot: 'shell.dock.end' }) })
    app.provide(CANVAS_CONTEXT_KEY, baseContext(ctx))
    const html = await renderToString(app)
    expect(html).toContain('data-demo')
    expect(html).toContain('扩展')
    ctx.stop()
  })
})
