import { describe, it, expect } from 'vitest'
import { createServerFramework } from '../serverFramework/index.js'

describe('装载顺序约束（Hono 路由冻结的防护）', () => {
  it('start() 之前调 app.fetch 抛错（防止路由表被过早冻结）', () => {
    const host = createServerFramework()
    // app 本身可访问（装配期要用它注册 cors/mcp），但 **fetch** 必须等 start() 之后。
    // 注意是同步 throw（守卫在调用前就拦下），故用 toThrow 而非 rejects。
    expect(() => host.app.fetch(new Request('http://x/health'))).toThrow(/start\(\)/)
  })

  it('start() 之后访问 app 正常', async () => {
    const host = createServerFramework()
    await host.start()
    expect(host.app).toBeDefined()
    expect(host.started).toBe(true)
  })

  it('直接调 ctx.start() 也能让 app 可用（走 ctx:ready）', async () => {
    const host = createServerFramework()
    await host.ctx.start()
    expect(host.started).toBe(true)
    expect((await host.app.fetch(new Request('http://x/nope'))).status).toBe(404)
  })
})
