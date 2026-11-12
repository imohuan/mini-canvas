/**
 * ctx.routes —— 插件注册路由（用户点 1）。
 *
 * 锁住四条关键行为（都基于实测结论，见计划 §1.3 与 Task 2 注释）：
 * 1. 插件能注册一条路由、命中返回它的响应；
 * 2. **卸载插件 → 它注册的路由消失**（这条是能力段的立身之本）；
 * 3. 能挂子应用（mount）；
 * 4. 同 path 的先注册者优先（Hono 的真实行为，不是后注册者）。
 * 外加一条约束：**装载必须在首次 fetch 之前完成**。
 */
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { createServerFramework } from '../serverFramework/index.js'

describe('ctx.routes：插件注册路由（用户点 1）', () => {
  it('插件能注册一条 GET，命中返回它的响应', async () => {
    const host = createServerFramework()
    host.ctx.plugin({
      name: 'my-api',
      apply: (c) => { c.routes.get('/api/my-thing', (h) => h.json({ hello: 'world' })) },
    })
    await host.ctx.start()
    const res = await host.app.fetch(new Request('http://x/api/my-thing'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hello: 'world' })
    host.ctx.stop()
  })

  it('支持 POST 与读取 JSON body', async () => {
    const host = createServerFramework()
    host.ctx.plugin({
      name: 'echo',
      apply: (c) => {
        c.routes.post('/api/echo', async (h) => h.json({ got: await h.req.json() }))
      },
    })
    await host.ctx.start()
    const res = await host.app.fetch(
      new Request('http://x/api/echo', {
        method: 'POST',
        body: JSON.stringify({ a: 1 }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(await res.json()).toEqual({ got: { a: 1 } })
    host.ctx.stop()
  })

  it('卸载插件 → 它注册的路由消失（作用域回收）', async () => {
    const host = createServerFramework()
    host.ctx.plugin({ name: 'gone', apply: (c) => { c.routes.get('/api/gone', (h) => h.text('x')) } })
    await host.ctx.start()
    expect((await host.app.fetch(new Request('http://x/api/gone'))).status).toBe(200)

    host.ctx.uninstallPlugin('gone')
    expect((await host.app.fetch(new Request('http://x/api/gone'))).status).toBe(404)
    host.ctx.stop()
  })

  it('能挂子应用（mount）', async () => {
    const host = createServerFramework()
    const sub = new Hono()
    sub.get('/ping', (h) => h.text('pong'))
    sub.get('/items/:id', (h) => h.text('item:' + h.req.param('id')))
    host.ctx.plugin({ name: 'sub', apply: (c) => { c.routes.mount('/subapi', sub) } })
    await host.ctx.start()
    expect(await (await host.app.fetch(new Request('http://x/subapi/ping'))).text()).toBe('pong')
    expect(await (await host.app.fetch(new Request('http://x/subapi/items/7'))).text()).toBe('item:7')
    host.ctx.stop()
  })

  it('卸载后子应用也摘掉', async () => {
    const host = createServerFramework()
    const sub = new Hono()
    sub.get('/ping', (h) => h.text('pong'))
    host.ctx.plugin({ name: 'sub2', apply: (c) => { c.routes.mount('/sub2', sub) } })
    await host.ctx.start()
    expect((await host.app.fetch(new Request('http://x/sub2/ping'))).status).toBe(200)
    host.ctx.uninstallPlugin('sub2')
    expect((await host.app.fetch(new Request('http://x/sub2/ping'))).status).toBe(404)
    host.ctx.stop()
  })

  it('两个插件注册同 path → 先注册者优先（Hono 真实行为）', async () => {
    const host = createServerFramework()
    host.ctx.plugin({ name: 'a', apply: (c) => { c.routes.get('/same', (h) => h.text('A')) } })
    host.ctx.plugin({ name: 'b', apply: (c) => { c.routes.get('/same', (h) => h.text('B')) } })
    await host.ctx.start()
    expect(await (await host.app.fetch(new Request('http://x/same'))).text()).toBe('A')
    host.ctx.stop()
  })

  it('未命中的路径 → 404（不吞掉）', async () => {
    const host = createServerFramework()
    await host.ctx.start()
    expect((await host.app.fetch(new Request('http://x/nothing-here'))).status).toBe(404)
    host.ctx.stop()
  })
})
