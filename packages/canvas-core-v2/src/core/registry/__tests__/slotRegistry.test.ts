/**
 * SlotRegistry —— 多 occupant 槽容器单测。
 * 覆盖：叠加/排序/替换/remove 单摘/auto-id/槽回收/空槽语义。零 Vue，Node 直跑。
 */
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '../slotRegistry'

describe('SlotRegistry.add / list 叠加', () => {
  it('未给 id 自动分配唯一 id，list 按放入序返回', () => {
    const r = new SlotRegistry()
    const a = r.add('dock.top', { value: 'A' })
    const b = r.add('dock.top', { value: 'B' })
    expect(a).not.toBe(b)
    expect(r.list('dock.top').map((e) => e.value)).toEqual(['A', 'B'])
  })

  it('一个槽可容纳多个 occupant（不重复抛错）', () => {
    const r = new SlotRegistry()
    r.add('dock.top', { value: 'A' })
    r.add('dock.top', { value: 'B' })
    r.add('dock.top', { value: 'C' })
    expect(r.list('dock.top')).toHaveLength(3)
  })
})

describe('order 排序', () => {
  it('list 按 order 升序，乱序放入也排好', () => {
    const r = new SlotRegistry()
    r.add('toolbar', { id: 'c', order: 30, value: 'C' })
    r.add('toolbar', { id: 'a', order: 10, value: 'A' })
    r.add('toolbar', { id: 'b', order: 20, value: 'B' })
    expect(r.list('toolbar').map((e) => e.value)).toEqual(['A', 'B', 'C'])
  })

  it('同 order 稳定保放入序', () => {
    const r = new SlotRegistry()
    r.add('s', { id: 'x', order: 1, value: 'X' })
    r.add('s', { id: 'y', order: 1, value: 'Y' })
    expect(r.list('s').map((e) => e.value)).toEqual(['X', 'Y'])
  })
})

describe('replace / 复用 id', () => {
  it('同 id 再 add = 替换不新增', () => {
    const r = new SlotRegistry()
    r.add('edge', { id: 'my', value: 'v1' })
    r.add('edge', { id: 'my', value: 'v2' })
    expect(r.list('edge')).toHaveLength(1)
    expect(r.get('edge', 'my')!.value).toBe('v2')
  })
})

describe('first（single 语义赢家）', () => {
  it('返回 order 最小者；空槽 undefined', () => {
    const r = new SlotRegistry()
    expect(r.first('bg')).toBeUndefined()
    r.add('bg', { id: 'low', order: 5, value: 'fallback' })
    r.add('bg', { id: 'win', order: 0, value: 'winner' })
    expect(r.first('bg')!.value).toBe('winner')
  })
})

describe('remove / 槽回收', () => {
  it('移除某 occupant 不影响同槽其它；槽空则 slots() 不再含它', () => {
    const r = new SlotRegistry()
    r.add('dock', { id: 'a', value: 'A' })
    r.add('dock', { id: 'b', value: 'B' })
    expect(r.remove('dock', 'a')).toBe(true)
    expect(r.list('dock').map((e) => e.value)).toEqual(['B'])
    expect(r.remove('dock', 'b')).toBe(true)
    expect(r.has('dock')).toBe(false)
    expect(r.slots()).not.toContain('dock')
  })

  it('remove 不存在的 id = no-op 返回 false', () => {
    const r = new SlotRegistry()
    r.add('s', { id: 'a', value: 'A' })
    expect(r.remove('s', 'nope')).toBe(false)
    expect(r.remove('nonexistent', 'a')).toBe(false)
  })
})

describe('has / ids / clear', () => {
  it('has/ids 反映 occupant', () => {
    const r = new SlotRegistry()
    expect(r.has('x')).toBe(false)
    r.add('x', { id: 'a', value: 1 })
    r.add('x', { id: 'b', value: 2 })
    expect(r.has('x')).toBe(true)
    expect(r.ids('x').sort()).toEqual(['a', 'b'])
  })
  it('clear 清空某槽全部', () => {
    const r = new SlotRegistry()
    r.add('x', { id: 'a', value: 1 })
    r.add('x', { id: 'b', value: 2 })
    r.clear('x')
    expect(r.list('x')).toEqual([])
    expect(r.has('x')).toBe(false)
  })
})
