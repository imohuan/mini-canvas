/**
 * serviceRegistration —— 锁"服务注册与依赖"这套契约。
 *
 * 依据：deepseek-harness/docs/user/develop/framework/service.zh.md（作者指定参考）。
 * 文档把服务模型讲成四件事，本文件逐条锁住：
 * ① 任何插件都能提供服务（不止框架）；② 消费方用 inject 声明硬依赖，apply 时保证就绪；
 * ③ 服务可依赖服务；④ 提供方消失 → 依赖方自动回收，恢复 → 自动重载；可选依赖走 ctx.get。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { Service } from '../service'
import type { PluginModule, PluginScope } from '../types'

// —— 编译期：declare module 声明合并，让 ctx.metrics 有类型（对齐文档类型声明节） ——
declare module '../Context' {
  interface Context {
    metrics: MetricsServiceImpl
  }
}

/** 记录器（被依赖的服务：消费方把事件推给它） */
interface Sink {
  push(line: string): void
}

/** 用 Service 基类提供服务：super(ctx, name) 即上架；服务可依赖服务（static inject） */
export class MetricsServiceImpl extends Service {
  static inject = ['sink'] as string[]
  readonly lines: string[] = []
  constructor(ctx: PluginScope) {
    super(ctx, 'metrics')
  }
  record(event: string, value: number): void {
    const line = event + ':' + value
    this.lines.push(line)
    const sink = this.ctx.get<Sink>('sink')
    if (sink) sink.push(line)
  }
}

/** 提供 sink 服务的最小插件（证明任何插件都能提供服务，不必是框架） */
function sinkPlugin(seen: string[]): PluginModule {
  return {
    name: 'sink-provider',
    apply(ctx: PluginScope) {
      ctx.provide('sink', { push: (line: string) => void seen.push(line) })
    },
  }
}

describe('服务注册（Service 基类 / provide）', () => {
  it('插件用 Service 子类提供服务，消费方 inject 后可直呼 ctx.metrics', async () => {
    const seen: string[] = []
    const ctx = new Context()
    ctx.plugin(sinkPlugin(seen))
    ctx.plugin(MetricsServiceImpl)
    ctx.plugin({
      name: 'consumer',
      inject: ['metrics'],
      apply(c: PluginScope) {
        const m = c.get<MetricsServiceImpl>('metrics')
        if (m) m.record('tool_call', 1)
      },
    })
    await ctx.start()
    expect(seen).toEqual(['tool_call:1'])
    ctx.stop()
  })

  it('提供方卸载 → 服务消失 → 依赖方自动回收；提供方恢复 → 依赖方自动重载', async () => {
    const ctx = new Context()
    let hits = 0
    ctx.plugin({
      name: 'svc-provider',
      apply(ctx: PluginScope) {
        ctx.provide('svc', { hello: () => 'hi' })
      },
    })
    ctx.plugin({
      name: 'svc-consumer',
      inject: ['svc'],
      apply(ctx: PluginScope) {
        ctx.on('ping', () => { hits += 1 })
      },
    })
    await ctx.start()
    ctx.emit('ping')
    expect(hits).toBe(1)

    ctx.uninstallPlugin('svc-provider')
    ctx.emit('ping')
    expect(hits).toBe(1)
    expect(ctx.inspectPlugins().find((p) => p.name === 'svc-consumer')?.missingDeps).toEqual(['svc'])

    ctx.installPlugin({
      name: 'svc-provider',
      apply(c: PluginScope) {
        c.provide('svc', { hello: () => 'hi again' })
      },
    })
    ctx.emit('ping')
    expect(hits).toBe(2)
    ctx.stop()
  })
})

describe('依赖的两种强度（对齐文档必需依赖与可选依赖）', () => {
  it('inject 是硬依赖：服务缺失则停在 PENDING，不部分运行', async () => {
    const ctx = new Context()
    let ran = false
    ctx.plugin({
      name: 'needs-nobody',
      inject: ['nobody-provides-this'],
      apply() {
        ran = true
      },
    })
    await ctx.start()
    expect(ran).toBe(false)
    expect(ctx.inspectPlugins().find((p) => p.name === 'needs-nobody')?.missingDeps).toEqual([
      'nobody-provides-this',
    ])
    ctx.stop()
  })

  it('内核自带 tools 恒在：inject: [tools] 的插件不会卡 PENDING', async () => {
    const ctx = new Context()
    let ran = false
    ctx.plugin({
      name: 'tool-user',
      inject: ['tools'],
      apply(c: PluginScope) {
        ran = true
        c.tools.register({
          name: 'demo.tool',
          run: () => ({ ok: true }),
        })
      },
    })
    await ctx.start()
    expect(ran).toBe(true)
    expect(ctx.tools.list().map((t) => t.name)).toEqual(['demo.tool'])
    ctx.stop()
  })

  it('不用 inject 走 ctx.get 探测：缺失返回 undefined，插件照常运行', async () => {
    const ctx = new Context()
    let observed: unknown = 'unset'
    ctx.plugin({
      name: 'optional',
      apply(c: PluginScope) {
        observed = c.get('nope')
      },
    })
    await ctx.start()
    expect(observed).toBeUndefined()
    ctx.stop()
  })
})
