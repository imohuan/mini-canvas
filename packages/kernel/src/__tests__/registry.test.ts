/**
 * Registry —— 通用注册场单测（纯逻辑，零 Vue，Node 直跑）。
 *
 * 锁的是设计文档 §2.1 的契约：add/remove/clear/clearByPrefix/list/top/get/has/ids/keys/
 * wrap/resolve/subscribe 的行为，以及"order 小者在最外"这一条最容易埋雷的栈序约定。
 */
import { describe, expect, it } from 'vitest'
import { RegistryImpl } from '../registry/registry'

describe('Registry · add / list（栈序 = order 升序从外到里）', () => {
  it('未给 id 自动分配唯一 id；list 按放入序返回', () => {
    const r = new RegistryImpl<string>()
    const a = r.add('node/shell', 'A')
    const b = r.add('node/shell', 'B')
    expect(a.id).not.toBe(b.id)
    expect(r.list('node/shell').map((e) => e.value)).toEqual(['A', 'B'])
  })

  it('order 小者在外：list 升序、top 取 order 最小者', () => {
    const r = new RegistryImpl<string>()
    r.add('t', 'inner', { id: 'i', order: 10 })
    r.add('t', 'outer', { id: 'o', order: -1 })
    expect(r.list('t').map((e) => e.id)).toEqual(['o', 'i'])
    expect(r.top('t')!.value).toBe('outer')
    expect(r.top('t')!.value).toBe(r.list('t')[0].value)
  })

  it('同 order 稳定保放入序（后放者排在后，不覆盖）', () => {
    const r = new RegistryImpl<string>()
    r.add('t', 'first', { id: 'a', order: 0 })
    r.add('t', 'second', { id: 'b', order: 0 })
    expect(r.list('t').map((e) => e.value)).toEqual(['first', 'second'])
  })

  it('同 id 再 add = 替换该条（不新增）', () => {
    const r = new RegistryImpl<string>()
    r.add('t', 'v1', { id: 'x' })
    r.add('t', 'v2', { id: 'x' })
    expect(r.list('t')).toHaveLength(1)
    expect(r.get('t', 'x')!.value).toBe('v2')
  })

  it('一个键可容纳多条（叠加，不重复抛错）', () => {
    const r = new RegistryImpl<string>()
    r.add('t', 'A')
    r.add('t', 'B')
    r.add('t', 'C')
    expect(r.list('t')).toHaveLength(3)
  })
})

describe('Registry · 空键语义', () => {
  it('空键：list=[]、top/get=undefined、has=false、ids=[]、keys 不含它', () => {
    const r = new RegistryImpl<string>()
    expect(r.list('nope')).toEqual([])
    expect(r.top('nope')).toBeUndefined()
    expect(r.get('nope', 'x')).toBeUndefined()
    expect(r.has('nope')).toBe(false)
    expect(r.ids('nope')).toEqual([])
    expect(r.keys()).toEqual([])
  })
})

describe('Registry · remove / clear / clearByPrefix', () => {
  it('remove 只摘那一条，不影响同键其它；键空则 keys 不再含它', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'A', { id: 'a' })
    r.add('k', 'B', { id: 'b' })
    expect(r.remove('k', 'a')).toBe(true)
    expect(r.list('k').map((e) => e.value)).toEqual(['B'])
    expect(r.remove('k', 'b')).toBe(true)
    expect(r.has('k')).toBe(false)
    expect(r.keys()).toEqual([])
  })

  it('remove 不存在的 id / 键 = no-op 返回 false', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'A', { id: 'a' })
    expect(r.remove('k', 'nope')).toBe(false)
    expect(r.remove('never', 'a')).toBe(false)
  })

  it('clear 清空某键全部', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'A')
    r.add('k', 'B')
    r.clear('k')
    expect(r.list('k')).toEqual([])
    expect(r.has('k')).toBe(false)
  })

  it('clearByPrefix 清掉前缀下全部键，旁键原位保留；空前缀 no-op', () => {
    const r = new RegistryImpl<string>()
    r.add('node/shell/image', 'I')
    r.add('node/shell/video', 'V')
    r.add('theme/edge', 'E')
    r.clearByPrefix('node/shell/')
    expect(r.keys()).toEqual(['theme/edge'])
    r.clearByPrefix('')
    expect(r.keys()).toEqual(['theme/edge'])
  })
})

describe('Registry · has / ids / keys', () => {
  it('has/ids 反映条目；keys 列出全部有内容的键', () => {
    const r = new RegistryImpl<number>()
    expect(r.has('x')).toBe(false)
    r.add('x', 1, { id: 'a' })
    r.add('x', 2, { id: 'b' })
    r.add('y', 3, { id: 'c' })
    expect(r.has('x')).toBe(true)
    expect(r.ids('x').sort()).toEqual(['a', 'b'])
    expect(r.keys().sort()).toEqual(['x', 'y'])
  })
})

describe('Registry · subscribe', () => {
  it('add/wrap/remove/clear 都触发；取消订阅后不再触发', () => {
    const r = new RegistryImpl<string>()
    let calls = 0
    const off = r.subscribe(() => {
      calls += 1
    })
    r.add('s', 'A')
    r.wrap('s', (inner) => inner + '!')
    r.remove('s', r.ids('s')[0])
    r.clear('s')
    expect(calls).toBe(4)
    off.dispose()
    r.add('s', 'B')
    expect(calls).toBe(4)
  })

  it('no-op（remove 不存在 / clear 空键 / clearByPrefix 无匹配）不触发', () => {
    const r = new RegistryImpl<string>()
    r.add('s', 'A', { id: 'a' })
    let calls = 0
    r.subscribe(() => {
      calls += 1
    })
    expect(r.remove('s', 'nope')).toBe(false)
    r.clear('never')
    r.clearByPrefix('z/')
    expect(calls).toBe(0)
  })
})

describe('Registry · wrap / resolve（叠加，永不覆盖原值）', () => {
  it('wrap 收到 inner（下面那层），resolve 从里到外套完', () => {
    const r = new RegistryImpl<string>()
    r.add('node/shell', 'base', { id: 'base' })
    r.wrap('node/shell', (inner) => '<badge>' + inner + '</badge>', { id: 'badge' })
    expect(r.resolve('node/shell')).toBe('<badge>base</badge>')
  })

  it('缺省放在最外：后 wrap 的一层在外面，先 wrap 的在里面', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'x', { id: 'base' })
    r.wrap('k', (inner) => '[' + inner + ']', { id: 'first' })
    r.wrap('k', (inner) => '{' + inner + '}', { id: 'second' })
    // second 更外 → 先套 first 再套 second
    expect(r.resolve('k')).toBe('{[x]}')
    expect(r.list('k').map((e) => e.id)).toEqual(['second', 'first', 'base'])
  })

  it('底层永远在：list 查得到全部历史层，含 source', () => {
    const r = new RegistryImpl<string>({ source: () => 'theme-default' })
    r.add('node/shell', 'BaseNode', { id: 'default' })
    r.wrap('node/shell', (inner) => 'My(' + inner + ')', { id: 'my-theme' })
    expect(r.list('node/shell').map((e) => e.id)).toEqual(['my-theme', 'default'])
    expect(r.list('node/shell').map((e) => e.source)).toEqual(['theme-default', 'theme-default'])
  })

  it('显式 order 的 wrap 按 order 插进栈里（可放进里面）', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'x', { id: 'base', order: 0 })
    r.wrap('k', (inner) => 'A(' + inner + ')', { id: 'a', order: -5 })
    r.wrap('k', (inner) => 'B(' + inner + ')', { id: 'b', order: -1 })
    expect(r.resolve('k')).toBe('A(B(x))')
  })

  it('wrap 的 dispose 只摘自己那层，其余层原位保留', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'x', { id: 'base' })
    const d = r.wrap('k', (inner) => 'W(' + inner + ')', { id: 'w' })
    expect(r.resolve('k')).toBe('W(x)')
    d.dispose()
    expect(r.resolve('k')).toBe('x')
    expect(r.get('k', 'w')).toBeUndefined()
  })

  it('空键 resolve = undefined', () => {
    const r = new RegistryImpl<string>()
    expect(r.resolve('nope')).toBeUndefined()
  })
})

describe('Registry · add 的返回句柄', () => {
  it('.id 与今天的 add 返回值一致（同 key 内唯一）', () => {
    const r = new RegistryImpl<string>()
    const h = r.add('t', 'v')
    expect(typeof h.id).toBe('string')
    expect(r.ids('t')).toEqual([h.id])
  })

  it('.dispose() 撤掉那一条，且幂等', () => {
    const r = new RegistryImpl<string>()
    const h = r.add('t', 'v', { id: 'once' })
    h.dispose()
    expect(r.get('t', 'once')).toBeUndefined()
    expect(() => h.dispose()).not.toThrow()
    expect(r.has('t')).toBe(false)
  })
})

describe('Registry · source（谁放的）', () => {
  it('bind 出来的视图把 source 写成放置方，且不串到别的视图', () => {
    const table = new RegistryImpl<string>()
    const a = table.bind('plugin-a')
    const b = table.bind('plugin-b')
    a.add('k', 'from-a', { id: 'a' })
    b.add('k', 'from-b', { id: 'b' })
    expect(table.list('k').map((e) => e.source)).toEqual(['plugin-a', 'plugin-b'])
  })

  it('未指定放置方时 source = <anonymous>', () => {
    const r = new RegistryImpl<string>()
    r.add('k', 'v', { id: 'x' })
    expect(r.get('k', 'x')!.source).toBe('<anonymous>')
  })
})

describe('Registry · bind 的自动回收', () => {
  it('bind 时给的回收器收走 add / wrap 的撤销', () => {
    const table = new RegistryImpl<string>()
    const undo: Array<() => void> = []
    const view = table.bind('p', (fn) => undo.push(fn))
    view.add('k', 'v', { id: 'a' })
    view.wrap('k', (inner) => inner + '!', { id: 'w' })
    expect(table.ids('k').sort()).toEqual(['a', 'w'])
    for (const fn of undo) fn()
    expect(table.has('k')).toBe(false)
  })
})

