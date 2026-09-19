/**
 * 能力包（设计文档 §4.5 / 案例 5 / 决策 9）—— 四条逐条锁死：
 * ① 任何插件都能注册（叠层 order 小者赢）；② **每节点一份**实例、由消费方回收；
 * ③ needs 缺项 dev 抛错 / prod undefined+warn；④ 未声明 needs = 空袋零开销。
 */
import { describe, it, expect, vi } from 'vitest'
import { RegistryImpl } from '@mini-canvas/kernel'
import {
  capabilityField,
  createCapabilityCache,
  type CapabilityFactory,
  type CapabilityNodeContext,
} from '../capabilities'

/** 最小节点上下文桩：只给工厂真读到的几项 */
function nodeCtx(over: Partial<CapabilityNodeContext> = {}): CapabilityNodeContext {
  return {
    ctx: {} as never,
    id: 'n1',
    type: 'image',
    data: { value: { label: 'hello' } } as never,
    selected: { value: false } as never,
    solo: { value: false } as never,
    zoom: { value: 1 } as never,
    update: () => {},
    ...over,
  }
}

/** 建一张能力场（用内核真 RegistryImpl，与生产 registryOf 同语义） */
function field(defs: Record<string, CapabilityFactory>): RegistryImpl<CapabilityFactory> {
  const f = new RegistryImpl<CapabilityFactory>()
  for (const [name, factory] of Object.entries(defs)) f.add(name, factory)
  return f
}

describe('能力包：注册与按名取用', () => {
  it('注册进 capability 场后，按名能取到该节点专属实例', () => {
    const cache = createCapabilityCache(field({ node: (n) => ({ id: n.id, type: n.type }) }), nodeCtx(), false)
    const bag = cache.bagFor(['node'], 'probe')
    expect(bag.node).toEqual({ id: 'n1', type: 'image' })
    cache.dispose()
  })

  it('**每节点一份**：同一节点上两条条目声明同一个 needs → 拿到同一个实例（状态才共享）', () => {
    let calls = 0
    const cache = createCapabilityCache(
      field({ tools: () => { calls += 1; return { id: 't' } } }),
      nodeCtx(),
      false,
    )
    // 模拟"按钮"与"它打开的面板"两条条目
    const buttonBag = cache.bagFor(['tools'], 'gen-button')
    const panelBag = cache.bagFor(['tools'], 'gen-panel')
    expect(calls).toBe(1)
    expect(buttonBag.tools).toBe(panelBag.tools)
    cache.dispose()
  })

  it('不同节点各一份：两个 cache（两节点）各调一次工厂', () => {
    const calls: string[] = []
    const f = field({ node: (n) => { calls.push(n.id); return { id: n.id } } })
    const a = createCapabilityCache(f, nodeCtx({ id: 'a' }), false)
    const b = createCapabilityCache(f, nodeCtx({ id: 'b' }), false)
    a.bagFor(['node'], 'e1')
    b.bagFor(['node'], 'e2')
    expect(calls).toEqual(['a', 'b'])
    a.dispose()
    b.dispose()
  })

  it('未声明 needs（缺省）= 空袋、零开销：工厂一次都不调', () => {
    const spy = vi.fn()
    const cache = createCapabilityCache(field({ node: spy }), nodeCtx(), false)
    expect(cache.bagFor(undefined, 'e')).toEqual({})
    expect(cache.bagFor([], 'e')).toEqual({})
    expect(spy).not.toHaveBeenCalled()
    cache.dispose()
  })

  it('换掉整套能力 = 叠一个更小 order 的条目（order 小者赢，原注册仍在）', () => {
    const f = field({})
    f.add('node', () => ({ tag: 'default' }), { id: 'default', order: 0 })
    f.add('node', () => ({ tag: 'themed' }), { id: 'neon', order: -1 })
    const cache = createCapabilityCache(f, nodeCtx(), false)
    expect(cache.bagFor(['node'], 'e').node).toEqual({ tag: 'themed' })
    // 原值没丢（"覆盖永不丢原值"）
    expect(f.list('node').map((e) => e.id)).toEqual(['neon', 'default'])
    cache.dispose()
  })
})

describe('能力包：实例回收（决策 9 第②条"由消费它的组件回收"）', () => {
  it('dispose() 回收全部实例：有 dispose() 的调 dispose()', () => {
    const disposed: string[] = []
    const cache = createCapabilityCache(
      field({
        a: () => ({ dispose: () => disposed.push('a') }),
        b: () => ({ stop: () => disposed.push('b') }),
        c: () => ({ plain: true }),
      }),
      nodeCtx(),
      false,
    )
    cache.bagFor(['a', 'b', 'c'], 'e')
    cache.dispose()
    expect(disposed.sort()).toEqual(['a', 'b'])
  })

  it('单个实例的 dispose 抛错不阻断其余（与注册场 notify 同一条原则）', () => {
    const disposed: string[] = []
    const cache = createCapabilityCache(
      field({
        boom: () => ({ dispose: () => { throw new Error('boom') } }),
        ok: () => ({ dispose: () => disposed.push('ok') }),
      }),
      nodeCtx(),
      false,
    )
    cache.bagFor(['boom', 'ok'], 'e')
    expect(() => cache.dispose()).not.toThrow()
    expect(disposed).toEqual(['ok'])
  })

  it('能力被热换（同名字段换成新工厂）→ 重造实例，旧实例先回收', () => {
    const disposed: string[] = []
    const f = field({})
    f.add('node', () => ({ gen: 1, dispose: () => disposed.push('v1') }), { id: 'default' })
    const cache = createCapabilityCache(f, nodeCtx(), false)
    expect(cache.bagFor(['node'], 'e').node).toMatchObject({ gen: 1 })
    // 主题插件顶上一个新的（同 id 替换 = 换实现）
    f.add('node', () => ({ gen: 2 }), { id: 'default' })
    expect(cache.bagFor(['node'], 'e').node).toMatchObject({ gen: 2 })
    expect(disposed).toEqual(['v1'])
    cache.dispose()
  })
})

describe('能力包：needs 缺项裁决（决策 9 第③条）', () => {
  it('dev（isDev=true）→ 当场抛错，消息写明缺哪个能力、谁的 needs', () => {
    const cache = createCapabilityCache(undefined, nodeCtx(), true)
    expect(() => cache.bagFor(['node'], 'gen-button')).toThrow(/\"gen-button\" 的 needs 里声明了 "node"/)
    cache.dispose()
  })

  it('prod（isDev=false）→ 那一格为 undefined + 一条 warn，不白屏', () => {
    const warn = vi.fn()
    const cache = createCapabilityCache(undefined, nodeCtx(), false, warn)
    const bag = cache.bagFor(['node', 'zoom'], 'gen-button')
    expect(bag).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls[0][0]).toContain('"node"')
    cache.dispose()
  })

  it('缺一项但另一项在：在的那项照常给（不因一项缺失整袋报废）', () => {
    const warn = vi.fn()
    const cache = createCapabilityCache(field({ zoom: () => ({ zoom: 1 }) }), nodeCtx(), false, warn)
    const bag = cache.bagFor(['zoom', 'nope'], 'e')
    expect(bag.zoom).toEqual({ zoom: 1 })
    expect(bag.nope).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    cache.dispose()
  })

  it('工厂自己抛错 → 如实抛出（不伪装成"能力缺失"，那是作者 bug）', () => {
    const cache = createCapabilityCache(
      field({ node: () => { throw new Error('factory boom') } }),
      nodeCtx(),
      false,
    )
    expect(() => cache.bagFor(['node'], 'e')).toThrow(/\"node\" 能力工厂抛错：factory boom/)
    cache.dispose()
  })
})

describe('能力包：场取用', () => {
  it('capabilityField 在无 ctx / 无 registryOf 时返回 undefined（不抛）', () => {
    expect(capabilityField(undefined)).toBeUndefined()
    expect(capabilityField({} as never)).toBeUndefined()
  })
})
