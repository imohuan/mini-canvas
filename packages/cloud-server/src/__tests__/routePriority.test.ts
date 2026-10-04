import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { Context, setDefaultCapabilityLayerFactory } from '@mini-canvas/kernel'
import { createServerCapabilityLayer } from '../serverFramework/capabilityLayer.js'
import { flushRoutes } from '../serverFramework/routes.js'

/**
 * 关键：静态路径 vs 动态路径的优先级由**插件装载顺序**决定。
 * `/api/kv/events`（events 插件）必须先于 `/api/kv/:type`（kv 插件）被 adopt，
 * 否则 events 会被 :type 吃掉（实测过这个坑）。
 */
function boot() {
  const app = new Hono()
  setDefaultCapabilityLayerFactory(() => createServerCapabilityLayer({ app }))
  const ctx = new Context()
  ctx.on('ctx:ready', () => flushRoutes(app, ctx))
  return { app, ctx }
}

describe('路由优先级由插件装载顺序决定（静态优先）', () => {
  it('events 插件先装 → /api/kv/events 命中静态', async () => {
    const { app, ctx } = boot()
    ctx.plugin({ name: 'kvStore', apply: () => {} })
    ctx.plugin({
      name: 'events',
      apply: (c) => {
        c.routes.get('/api/kv/events', (h) => h.text('SSE'))
      },
    })
    ctx.plugin({
      name: 'kv',
      apply: (c) => { c.routes.get('/api/kv/:type', (h) => h.text('kvtype:' + h.req.param('type'))) },
    })
    await ctx.start()
    expect(await (await app.fetch(new Request('http://x/api/kv/events'))).text()).toBe('SSE')
    expect(await (await app.fetch(new Request('http://x/api/kv/settings'))).text()).toBe('kvtype:settings')
    ctx.stop()
  })

  it('反序装（kv 先）→ events 被吃掉（证明顺序确实关键，不是想当然）', async () => {
    const { app, ctx } = boot()
    ctx.plugin({
      name: 'kv',
      apply: (c) => { c.routes.get('/api/kv/:type', (h) => h.text('kvtype:' + h.req.param('type'))) },
    })
    ctx.plugin({
      name: 'events',
      apply: (c) => { c.routes.get('/api/kv/events', (h) => h.text('SSE')) },
    })
    await ctx.start()
    expect(await (await app.fetch(new Request('http://x/api/kv/events'))).text()).toBe('kvtype:events')
    ctx.stop()
  })

  it('adopt 保持子应用内部顺序（events 在 kvRoutes 之前）', async () => {
    const { app, ctx } = boot()
    const { Hono: H } = await import('hono')
    const sub = new H()
    sub.get('/api/kv/events', (h) => h.text('SSE'))
    sub.get('/api/kv/:type', (h) => h.text('kvtype:' + h.req.param('type')))
    ctx.plugin({ name: 'one-plugin', apply: (c) => { c.routes.adopt(sub) } })
    await ctx.start()
    expect(await (await app.fetch(new Request('http://x/api/kv/events'))).text()).toBe('SSE')
    ctx.stop()
  })
})
