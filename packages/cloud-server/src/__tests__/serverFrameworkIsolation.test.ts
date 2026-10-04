import { describe, it, expect } from 'vitest'
import { createServerFramework } from '../serverFramework/index.js'

describe('多个 framework 实例互不干扰（能力层是全局工厂的坑）', () => {
  it('两个 host 各自的路由不串（第二个 host 的 app 只认得自己的路由）', async () => {
    const h1 = createServerFramework()
    const h2 = createServerFramework()
    h1.ctx.plugin({ name: 'only-in-h1', apply: (c) => { c.routes.get('/in-h1', (x) => x.text('H1')) } })
    h2.ctx.plugin({ name: 'only-in-h2', apply: (c) => { c.routes.get('/in-h2', (x) => x.text('H2')) } })
    await h1.start()
    await h2.start()
    expect(await (await h1.app.fetch(new Request('http://x/in-h1'))).text()).toBe('H1')
    expect(await (await h2.app.fetch(new Request('http://x/in-h2'))).text()).toBe('H2')
    // h1 不该有 h2 的路由，反之亦然
    expect((await h1.app.fetch(new Request('http://x/in-h2'))).status).toBe(404)
    expect((await h2.app.fetch(new Request('http://x/in-h1'))).status).toBe(404)
    h1.ctx.stop()
    h2.ctx.stop()
  })
})
