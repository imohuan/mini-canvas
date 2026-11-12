/**
 * Context 上的三个新原语：registryOf(kind) / state(initial) / isDev。
 *
 * 这里刻意**从插件作用域 ctx 上取**（而不是先拿根 Context），因为插件 ctx 是个 Proxy：
 * 它的 get 逻辑是"prop in target 才走真实成员，否则当服务名去查表（查不到返回 undefined，不报错）"。
 * 漏挂 = 插件里静默拿到 undefined。所以本文件的每个用例都是一道"挂没挂上"的哨兵。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '../Context'
import type { State } from '../types'
import type { Registry } from '../registry/registry'
import type { PluginScope } from '../types'

describe('ctx.registryOf —— 插件作用域上必须真挂上（Proxy 坑）', () => {
  it('插件 ctx.registryOf 是函数（漏挂则静默 undefined）', async () => {
    const ctx = new Context()
    let seen: unknown = 'unset'
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        seen = typeof (c as unknown as Record<string, unknown>).registryOf
      },
    })
    await ctx.start()
    expect(seen).toBe('function')
    ctx.stop()
  })

  it('放进去的条目能被同一插件读回，source = 插件名', async () => {
    const ctx = new Context()
    let values: string[] = []
    let source = ''
    ctx.plugin({
      name: 'alpha',
      apply(c: PluginScope) {
        const reg = c.registryOf<string>('demo')
        reg.add('k', 'A', { id: 'a' })
        values = reg.list('k').map((e) => e.value)
        source = reg.top('k')!.source
      },
    })
    await ctx.start()
    expect(values).toEqual(['A'])
    expect(source).toBe('alpha')
    ctx.stop()
  })
})

describe('ctx.registryOf —— 两个插件共享同一张表（才谈得上"别人放的东西我能用"）', () => {
  it('B 看得到 A 放的条目；卸载 A 后 B 的条目原位保留', async () => {
    const ctx = new Context()
    let seenByB: Array<{ id: string; value: string; source: string }> = []
    ctx.plugin({
      name: 'alpha',
      apply(c: PluginScope) {
        c.registryOf<string>('ui').add('button', 'AlphaButton', { id: 'alpha-btn' })
      },
    })
    ctx.plugin({
      name: 'beta',
      apply(c: PluginScope) {
        const reg = c.registryOf<string>('ui')
        reg.add('dropdown', 'BetaDropdown', { id: 'beta-dd' })
        seenByB = reg.list('button').map((e) => ({ id: e.id, value: e.value, source: e.source }))
      },
    })
    await ctx.start()
    expect(seenByB).toEqual([{ id: 'alpha-btn', value: 'AlphaButton', source: 'alpha' }])

    ctx.uninstallPlugin('alpha')
    const after = ctx.registryOf<string>('ui').list('dropdown')
    expect(after.map((e) => e.id)).toEqual(['beta-dd'])
    ctx.stop()
  })

  it('卸载插件，它放的条目一条不留（add 与 wrap 一起清）', async () => {
    const ctx = new Context()
    let seen: string[] = []
    ctx.plugin({
      name: 'alpha',
      apply(c: PluginScope) {
        const reg = c.registryOf<string>('demo')
        reg.add('k', 'base', { id: 'base' })
        reg.wrap('k', (inner) => '[' + inner + ']', { id: 'wrap' })
      },
    })
    await ctx.start()
    expect(ctx.registryOf<string>('demo').ids('k').sort()).toEqual(['base', 'wrap'])
    ctx.uninstallPlugin('alpha')
    expect(ctx.registryOf<string>('demo').ids('k')).toEqual([])
    expect(ctx.registryOf<string>('demo').keys()).toEqual([])
    ctx.stop()
  })

  it('插件里 subscribe 的监听随插件卸载自动解除', async () => {
    const ctx = new Context()
    let calls = 0
    ctx.plugin({
      name: 'watcher',
      apply(c: PluginScope) {
        c.registryOf<string>('demo').subscribe(() => {
          calls += 1
        })
      },
    })
    await ctx.start()
    ctx.registryOf<string>('demo').add('k', 'A')
    expect(calls).toBe(1)
    ctx.uninstallPlugin('watcher')
    ctx.registryOf<string>('demo').add('k', 'B')
    expect(calls).toBe(1)
    ctx.stop()
  })

  it('插件里 wrap 收到 inner，resolve 给出合成结果', async () => {
    const ctx = new Context()
    let resolved: string | undefined
    ctx.plugin({
      name: 'base-layer',
      apply(c: PluginScope) {
        c.registryOf<string>('shell').add('image', 'BaseShell', { id: 'default' })
      },
    })
    ctx.plugin({
      name: 'my-theme',
      apply(c: PluginScope) {
        const reg = c.registryOf<string>('shell')
        reg.wrap('image', (inner) => 'Badged(' + inner + ')', { id: 'badge' })
        resolved = reg.resolve('image')
      },
    })
    await ctx.start()
    expect(resolved).toBe('Badged(BaseShell)')
    ctx.stop()
  })

  it('宿主直接 registryOf 也有一份（source = <host>），随 stop 清空', async () => {
    const ctx = new Context()
    await ctx.start()
    const reg = ctx.registryOf<string>('command')
    reg.add('mini-map:toggle', 'def', { id: 'toggle' })
    expect(reg.top('mini-map:toggle')!.source).toBe('<host>')
    ctx.stop()
    expect(new Context().registryOf<string>('command').keys()).toEqual([])
  })
})

describe('ctx.state —— 插件私有状态，不占服务名', () => {
  it('插件 ctx.state 是函数，形状是 { value }，可读写', async () => {
    const ctx = new Context()
    let seen: unknown = 'unset'
    let shape: string[] = []
    let read = 0
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        seen = typeof (c as unknown as Record<string, unknown>).state
        const st = c.state(1)
        shape = Object.keys(st)
        st.value = 2
        read = st.value
      },
    })
    await ctx.start()
    expect(seen).toBe('function')
    expect(shape).toEqual(['value'])
    expect(read).toBe(2)
    ctx.stop()
  })

  it('两个插件各自的 state 互不可见，也不是服务（ctx.get 取不到）', async () => {
    const ctx = new Context()
    const aStates: State<string>[] = []
    const bStates: State<string>[] = []
    let bSawService: unknown = 'unset'
    ctx.plugin({
      name: 'alpha',
      apply(c: PluginScope) {
        aStates.push(c.state('alpha-only'))
      },
    })
    ctx.plugin({
      name: 'beta',
      apply(c: PluginScope) {
        bStates.push(c.state('beta-only'))
        bSawService = c.get('state')
      },
    })
    await ctx.start()
    expect(aStates[0].value).toBe('alpha-only')
    expect(bStates[0].value).toBe('beta-only')
    expect(aStates[0]).not.toBe(bStates[0])
    expect(bSawService).toBeUndefined()
    ctx.stop()
  })

  it('卸载插件后该 state 被回收（不再可达）', async () => {
    const ctx = new Context()
    const states: State<{ big: string }>[] = []
    ctx.plugin({
      name: 'alpha',
      apply(c: PluginScope) {
        states.push(c.state({ big: 'payload' }))
      },
    })
    await ctx.start()
    expect(states[0].value).toEqual({ big: 'payload' })
    ctx.uninstallPlugin('alpha')
    expect(states[0].value).toBeUndefined()
    ctx.stop()
  })
})

describe('ctx.isDev —— 公开可读（原来只是私有字段，插件读不到）', () => {
  it('插件 ctx.isDev 能读到 true（dev 模式）', async () => {
    const ctx = new Context({ dev: true })
    let seen: unknown = 'unset'
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        seen = (c as unknown as Record<string, unknown>).isDev
      },
    })
    await ctx.start()
    expect(seen).toBe(true)
    ctx.stop()
  })

  it('非 dev 时根 ctx 与插件 ctx 都读到 false', async () => {
    const ctx = new Context()
    let seen: unknown = 'unset'
    ctx.plugin({
      name: 'probe',
      apply(c: PluginScope) {
        seen = (c as unknown as Record<string, unknown>).isDev
      },
    })
    await ctx.start()
    expect(ctx.isDev).toBe(false)
    expect(seen).toBe(false)
    ctx.stop()
  })
})

describe('新原语不抢服务名（与 ctx.registry 诊断名共存）', () => {
  it('registryOf / state / isDev 都不是服务；ctx.registry 仍是诊断视图', async () => {
    const ctx = new Context()
    await ctx.start()
    expect(ctx.hasService('registryOf')).toBe(false)
    expect(ctx.hasService('state')).toBe(false)
    expect(ctx.hasService('isDev')).toBe(false)
    expect(ctx.registry.get('nope')).toBeUndefined()
    ctx.stop()
  })

  it('同一个 kind 反复 registryOf 拿到的是同一张表（只是视图各自记 source）', async () => {
    const ctx = new Context()
    await ctx.start()
    const a: Registry<string> = ctx.registryOf<string>('demo')
    const b: Registry<string> = ctx.registryOf<string>('demo')
    a.add('k', 'A', { id: 'a' })
    expect(b.list('k').map((e) => e.value)).toEqual(['A'])
    ctx.stop()
  })
})
