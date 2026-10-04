/**
 * 证明 cloud-server 能用 @mini-canvas/kernel（打包内联的前提）。
 *
 * 为什么单测这一条：后台插件系统要跑在**同一个 kernel** 上（不另造一套）。
 * 这条测试证明"Node 侧的 cloud-server 能 import 并运行 kernel"——是后面所有 Task 的地基。
 * 注意：这里 import 的是**真实包名**（不是 vendored 副本），与业务代码的写法一致。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/kernel'

describe('cloud-server 能用内核（打包内联的前提）', () => {
  it('能建 Context、装插件、apply 被调用', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.plugin({ name: 'p1', apply: (c) => { seen.push('applied:' + typeof c.effect) } })
    await ctx.start()
    expect(seen).toEqual(['applied:function'])
    ctx.stop()
  })

  it('ctx.effect 随卸载回收（后台插件系统的基础承诺）', async () => {
    const ctx = new Context()
    let disposed = false
    ctx.plugin({ name: 'p2', apply: (c) => { c.effect(() => () => { disposed = true }) } })
    await ctx.start()
    ctx.uninstallPlugin('p2')
    expect(disposed).toBe(true)
    ctx.stop()
  })

  it('注册场可用（后台插件注册路由/工具的地基）', async () => {
    const ctx = new Context()
    ctx.plugin({ name: 'p3', apply: (c) => { c.registryOf<number>('demo').add('k', 1, { id: 'a' }) } })
    await ctx.start()
    expect(ctx.registryOf<number>('demo').get('k', 'a')?.value).toBe(1)
    ctx.stop()
  })
})
