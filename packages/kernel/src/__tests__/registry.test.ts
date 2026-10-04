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

  it('同一个放置方同 id 再 add = 替换自己那层（不叠高、不泄漏）', () => {
    const r = new RegistryImpl<string>()
    const a = r.bind('plugin-a')
    a.add('k', 'v1', { id: 'x' })
    a.add('k', 'v2', { id: 'x' })
    a.add('k', 'v3', { id: 'x' })
    expect(r.ids('k')).toEqual(['x'])
    expect(r.get('k', 'x')!.value).toBe('v3')
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

/**
 * 不同插件用同一个 id（底栏动作就是这种：内置 web2api 与云端 cloud-client 都注册
 * 同名的 web2api:* 动作）必须**叠层，不能互删**。
 *
 * 为什么单开一组：早先 add 是"同 id 破坏性替换" —— 后注册者把先注册者从表里删掉，
 * 后注册者一卸载，先注册者的那条也整条消失（用户实测报过）。这组用例钉住"叠层 + 撤销露底"。
 */
describe('Registry · 不同放置方同 id = 叠层（撤销上层，下层露出来）', () => {
  it('后注册者盖住先注册者；撤销后注册者 → 先注册者自动恢复（不是整条消失）', () => {
    const r = new RegistryImpl<string>()
    const a = r.bind('plugin-a')
    const b = r.bind('plugin-b')
    a.add('node/bar', 'A 的动作', { id: 'web2api:x' })
    const hb = b.add('node/bar', 'B 的动作', { id: 'web2api:x' })

    // 台面上只看得见一条（后注册的 B 在外）
    expect(r.list('node/bar')).toHaveLength(1)
    expect(r.get('node/bar', 'web2api:x')!.value).toBe('B 的动作')
    expect(r.get('node/bar', 'web2api:x')!.source).toBe('plugin-b')

    // 卸载 B：只是把它那层拿走，A 那层露出来 —— 这是修复的核心断言
    hb.dispose()
    expect(r.get('node/bar', 'web2api:x')!.value).toBe('A 的动作')
    expect(r.get('node/bar', 'web2api:x')!.source).toBe('plugin-a')
  })

  it('反序撤销：先撤下层（A）→ 上层（B）不受影响；再撤 B → 该 id 才真正消失', () => {
    const r = new RegistryImpl<string>()
    const a = r.bind('plugin-a')
    const b = r.bind('plugin-b')
    const ha = a.add('k', 'A', { id: 'x' })
    const hb = b.add('k', 'B', { id: 'x' })

    ha.dispose() // 撤下面那层
    expect(r.get('k', 'x')!.value).toBe('B')
    hb.dispose()
    expect(r.has('k')).toBe(false)
  })

  it('三层叠加：逐层撤销按后进先出露出来', () => {
    const r = new RegistryImpl<string>()
    const h1 = r.bind('p1').add('k', '1', { id: 'x' })
    const h2 = r.bind('p2').add('k', '2', { id: 'x' })
    const h3 = r.bind('p3').add('k', '3', { id: 'x' })
    expect(r.get('k', 'x')!.value).toBe('3')
    h3.dispose()
    expect(r.get('k', 'x')!.value).toBe('2')
    h2.dispose()
    expect(r.get('k', 'x')!.value).toBe('1')
    h1.dispose()
    expect(r.has('k')).toBe(false)
  })

  it('bind 的自动回收（= 插件卸载）走的也是"只摘自己那层"', () => {
    const table = new RegistryImpl<string>()
    const undoB: Array<() => void> = []
    const a = table.bind('plugin-a')
    const b = table.bind('plugin-b', (fn) => undoB.push(fn))
    a.add('k', 'A', { id: 'x' })
    b.add('k', 'B', { id: 'x' })
    expect(table.get('k', 'x')!.value).toBe('B')

    // 模拟卸载 plugin-b
    for (const fn of undoB) fn()
    expect(table.get('k', 'x')!.value).toBe('A')
  })

  it('显式 remove(key,id) 清该 id 的**整摞**（彻底不要这个 id 了）', () => {
    const r = new RegistryImpl<string>()
    r.bind('plugin-a').add('k', 'A', { id: 'x' })
    r.bind('plugin-b').add('k', 'B', { id: 'x' })
    expect(r.remove('k', 'x')).toBe(true)
    expect(r.has('k')).toBe(false)
  })

  it('叠层时显式 order 仍决定谁在外（小者在外，压过后注册的新层）', () => {
    const r = new RegistryImpl<string>()
    const a = r.bind('plugin-a')
    const b = r.bind('plugin-b')
    a.add('k', 'A(高级皮)', { id: 'x', order: -1 })
    b.add('k', 'B(普通)', { id: 'x', order: 0 })
    expect(r.get('k', 'x')!.value).toBe('A(高级皮)')
  })
})
