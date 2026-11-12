/**
 * 内置插件 —— 把现有路由组收敛成"内置后台插件"。
 *
 * 这一步的验收标准不是"新功能"，而是**行为逐条不变**：
 * 收敛前后的路由请求结果必须一模一样（含静态/动态路径的优先级）。
 *
 * 本文件先锁 health（最简单的样板），再逐组迁移其余路由（见后续测试）。
 */
import { describe, it, expect } from 'vitest'
import { createServerFramework } from '../serverFramework/index.js'
import { healthPlugin } from '../plugins/builtin/health.js'

describe('内置插件：health', () => {
  it('注册后 GET /health 返回 ok', async () => {
    const host = createServerFramework()
    host.ctx.plugin(healthPlugin)
    await host.start()
    const res = await host.app.fetch(new Request('http://x/health'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    host.ctx.stop()
  })

  it('卸载后 /health 消失（内置插件也遵守作用域回收）', async () => {
    const host = createServerFramework()
    host.ctx.plugin(healthPlugin)
    await host.start()
    expect((await host.app.fetch(new Request('http://x/health'))).status).toBe(200)
    host.ctx.uninstallPlugin(healthPlugin.name)
    expect((await host.app.fetch(new Request('http://x/health'))).status).toBe(404)
    host.ctx.stop()
  })
})
