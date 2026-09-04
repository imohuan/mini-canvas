import { describe, it, expect } from 'vitest'
import { Selection } from '../selection'
import { History } from '../history'
import type { HistorySnapshot } from '../history'
import { CommandRegistry } from '../command'
import { NodeFactory } from '../nodeFactory'

describe('Selection（选中集服务）', () => {
  it('set/has/add/remove/clear/size 语义正确', () => {
    const s = new Selection()
    s.set(['1', '2'])
    expect(s.size).toBe(2)
    expect(s.has('1')).toBe(true)
    s.add('3')
    expect(s.size).toBe(3)
    s.remove('1')
    expect(s.has('1')).toBe(false)
    s.clear()
    expect(s.size).toBe(0)
    expect([...s.ids]).toEqual([])
  })
})

/** 用可写数组当"被记录状态"，验证 history 快照语义（独立于 nodeStore） */
function makeHistoryState(): { arr: number[]; hist: History } {
  const arr: number[] = [1, 2]
  const snapshot: HistorySnapshot<number[]> = {
    snapshot: () => [...arr],
    // 原地改（保留同一引用，测试读的 arr 才能看到 restore 效果）
    restore: (s) => {
      arr.length = 0
      arr.push(...s)
    },
  }
  return { arr, hist: new History(snapshot) }
}

describe('History（快照撤销/重做，最小版）', () => {
  it('withRecord 记录改变，undo 还原、redo 重放', () => {
    const { arr, hist } = makeHistoryState()
    hist.withRecord(() => {
      arr.push(3) // [1,2,3]
    })
    expect(arr).toEqual([1, 2, 3])
    expect(hist.canUndo()).toBe(true)

    hist.undo()
    expect(arr).toEqual([1, 2])
    expect(hist.canUndo()).toBe(false)
    expect(hist.canRedo()).toBe(true)

    hist.redo()
    expect(arr).toEqual([1, 2, 3])
  })

  it('withRecord 里没真变 → 不入历史', () => {
    const { arr, hist } = makeHistoryState()
    hist.withRecord(() => {
      arr[0] = 1 // 改回同值
    })
    expect(hist.canUndo()).toBe(false)
  })

  it('undo 后再改 → redo 栈清空（新分支）', () => {
    const { arr, hist } = makeHistoryState()
    hist.withRecord(() => arr.push(3))
    hist.undo()
    expect(hist.canRedo()).toBe(true)
    hist.withRecord(() => arr.push(9)) // 新操作
    expect(hist.canRedo()).toBe(false)
    expect(arr).toEqual([1, 2, 9])
  })

  it('嵌套 withRecord 只记一次（原子操作）', () => {
    const { arr, hist } = makeHistoryState()
    hist.withRecord(() => {
      arr.push(3)
      hist.withRecord(() => arr.push(4))
    })
    expect(hist.undoDepth).toBe(1)
    hist.undo()
    expect(arr).toEqual([1, 2])
  })
})

describe('CommandRegistry（命令服务）', () => {
  it('register→execute→注销；重复 id 抛错', () => {
    const c = new CommandRegistry()
    let ran = 0
    const disp = c.register({ id: 'a', run: () => (ran += 1) })
    c.execute('a')
    expect(ran).toBe(1)
    // 重复注册抛错
    expect(() => c.register({ id: 'a', run: () => {} })).toThrow(/already registered/i)
    disp.dispose()
    c.execute('a') // 已注销 → no-op
    expect(ran).toBe(1)
    expect(c.has('a')).toBe(false)
    // 注销后可再注册
    c.register({ id: 'a', run: () => {} })
    expect(c.has('a')).toBe(true)
  })

  it('when 读 setContext 的 ctx；为假 → execute no-op；未注册 id → no-op 不抛', () => {
    const c = new CommandRegistry()
    c.setContext({ ok: false })
    let ran = 0
    c.register({ id: 'guarded', when: (ctx) => (ctx as { ok: boolean }).ok, run: () => (ran += 1) })
    c.execute('guarded')
    expect(ran).toBe(0)
    c.setContext({ ok: true })
    c.execute('guarded')
    expect(ran).toBe(1)
    expect(() => c.execute('missing', {})).not.toThrow()
  })

  it('run 收到 ctx 与 execute 透传的 payload', () => {
    const c = new CommandRegistry()
    c.setContext({ tag: 'ctx' })
    const got: unknown[] = []
    c.register({ id: 'p', run: (ctx, ...payload) => got.push(ctx, payload) })
    c.execute('p', 1, 2)
    expect(got).toEqual([{ tag: 'ctx' }, [1, 2]])
  })
})

describe('NodeFactory（统一建节点工厂）', () => {
  it('register 后 create 调 creator；未注册抛错；creatableTypes 枚举', () => {
    const f = new NodeFactory()
    const made: string[] = []
    f.register('text', (pos, extra) => {
      made.push(`${pos.x},${pos.y},${String(extra)}`)
      return '1'
    })
    const id = f.create('text', { x: 5, y: 6 }, 'hi')
    expect(id).toBe('1')
    expect(made).toEqual(['5,6,hi'])
    expect(f.creatableTypes()).toEqual(['text'])
    expect(() => f.create('image', { x: 0, y: 0 })).toThrow(/no creator/i)
    expect(() => f.register('text', () => 'x')).toThrow(/already registered/i)
  })
})
