/**
 * CanvasContext —— 外壳和画布共用的一层“基础上下文”。
 *
 * 只装 ctx / host / api / manager 四样；视口、渲染快照这些只属于 CanvasHost 内部，
 * 仍走 useCanvasRender()。这里锁两条：
 * 1. Provider 内能拿到完整四样；
 * 2. 不在 Provider 内必须响亮失败，绝不偷偷回退到 RENDER_CONTEXT_KEY
 *    （否则“为什么外壳里读到的是画布上下文”又会变成一类静默 bug）。
 */
import { describe, expect, it } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { Context } from '@mini-canvas/canvas-data'
import type { CanvasHostHandle, MiniCanvasApi } from '../../host/createMiniCanvasHost'
import type { PluginManager } from '../../host/pluginManager'
import { CANVAS_CONTEXT_KEY, useCanvasContext } from '../canvasContext'

const Probe = defineComponent({
  name: 'CanvasContextProbe',
  setup() {
    const { ctx, host, api, manager } = useCanvasContext()
    return () =>
      h(
        'div',
        {
          'data-probe': 'ok',
          'data-state': ctx.getState(),
          'data-host': host === undefined ? 'missing' : 'present',
          'data-api': api === undefined ? 'missing' : 'present',
          'data-manager': manager === undefined ? 'missing' : 'present',
        },
        'probe',
      )
  },
})

describe('CanvasContext', () => {
  it('在 Provider 内取到 ctx / host / api / manager', async () => {
    const ctx = new Context()
    const host = { ctx } as unknown as CanvasHostHandle
    const api = {} as MiniCanvasApi
    const manager = {} as PluginManager
    const app = createSSRApp(Probe)
    app.provide(CANVAS_CONTEXT_KEY, { ctx, host, api, manager })
    const html = await renderToString(app)
    expect(html).toContain('data-probe="ok"')
    expect(html).toContain('data-state="created"')
    expect(html).toContain('data-host="present"')
    expect(html).toContain('data-api="present"')
    expect(html).toContain('data-manager="present"')
  })

  it('没有 Provider 时直接抛错，不回退读渲染上下文', async () => {
    const app = createSSRApp(Probe)
    await expect(renderToString(app)).rejects.toThrow(/CanvasProvider/)
  })
})
