/**
 * 渲染子树兼容：只 provide 了渲染上下文（RENDER_CONTEXT_KEY）时，
 * useCanvasContextOrRender 也要把 ctx + host 一起透传。
 *
 * 为什么锁：SettingsHost 要读 host.themeRegistry.winner('settingsPanel')。
 * 旧实现只回 { ctx }，设置面板在画布子树里会永远显示空槽（真机可见）。
 */
import { describe, expect, it } from 'vitest'
import { defineComponent, h, type InjectionKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createSSRApp } from 'vue'
import { Context } from '@mini-canvas/kernel'
import { useCanvasContextOrRender } from '../context'

/** 注入键在本包是 Symbol.for 的名字；这里是照名字取同一个键（与 context.ts 同源）。 */
const RENDER_KEY = Symbol.for('canvas-v2-render-context') as unknown as InjectionKey<{
  ctx: Context
  host?: unknown
}>
const BASE_KEY = Symbol.for('mini-canvas-context') as unknown as InjectionKey<{ ctx: Context }>

function renderProbe(provideRender: boolean): Promise<string> {
  const ctx = new Context()
  const host = { themeRegistry: { winner: () => 'winner' } }
  const Probe = defineComponent({
    setup() {
      const got = useCanvasContextOrRender()
      return () => h('span', { 'data-has-host': got.host ? 'yes' : 'no' }, got.ctx ? 'ctx' : 'none')
    },
  })
  const app = createSSRApp({ render: () => h(Probe) })
  if (provideRender) {
    app.provide(RENDER_KEY, { ctx, host })
  } else {
    app.provide(BASE_KEY, { ctx })
  }
  return renderToString(app)
}

describe('useCanvasContextOrRender', () => {
  it('渲染上下文里带 host 时一并透传（设置面板要读 themeRegistry）', async () => {
    const html = await renderProbe(true)
    expect(html).toContain('data-has-host="yes"')
    expect(html).toContain('>ctx<')
  })

  it('基础上下文（CANVAS_CONTEXT_KEY）优先，原样返回', async () => {
    const html = await renderProbe(false)
    expect(html).toContain('data-has-host="no"')
    expect(html).toContain('>ctx<')
  })
})
