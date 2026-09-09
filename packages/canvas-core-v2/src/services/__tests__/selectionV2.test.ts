import { describe, it, expect } from 'vitest'
import { Selection } from '../selection'

/**
 * Selection v2 契约 —— 用户拍板 2A：
 *  - ids 保持节点 id 集语义原样不动（现有命令/删除零改动）；
 *  - 新增 edgeIds 边 id 集 + 边专属增删；
 *  - onChange 在任一桶变化时触发，且触发时 ids/edgeIds 均为最新快照。
 */
describe('Selection v2（节点 + 边双集）', () => {
  it('edgeIds 初始为空；addEdge/hasEdge/setEdges/removeEdge 语义正确', () => {
    const s = new Selection()
    expect([...s.edgeIds]).toEqual([])
    s.addEdge('e1')
    expect(s.hasEdge('e1')).toBe(true)
    expect([...s.edgeIds]).toEqual(['e1'])
    s.setEdges(['e1', 'e2'])
    expect(s.edgeIds.size).toBe(2)
    s.removeEdge('e1')
    expect(s.hasEdge('e1')).toBe(false)
    expect([...s.edgeIds]).toEqual(['e2'])
  })

  it('ids(节点) 与 edgeIds(边) 互不影响', () => {
    const s = new Selection()
    s.set(['n1'])
    s.addEdge('e9')
    expect([...s.ids]).toEqual(['n1'])
    expect([...s.edgeIds]).toEqual(['e9'])
    expect(s.has('e9')).toBe(false) // has 仍只查节点桶
    expect(s.hasEdge('n1')).toBe(false)
  })

  it('clear() 同时清空节点与边两桶并触发一次 onChange', () => {
    const s = new Selection()
    s.set(['n1'])
    s.addEdge('e1')
    let calls = 0
    s.onChange(() => (calls += 1))
    s.clear()
    expect(calls).toBe(1)
    expect(s.ids.size).toBe(0)
    expect(s.edgeIds.size).toBe(0)
  })

  it('onChange 在节点或边任一桶变化后触发，且快照为最新', () => {
    const s = new Selection()
    const seen: Array<{ nodes: string[]; edges: string[] }> = []
    s.onChange(() => seen.push({ nodes: [...s.ids], edges: [...s.edgeIds] }))
    s.set(['a'])          // 节点变化
    s.addEdge('ea')       // 边变化
    s.removeEdge('ea')    // 边变化
    expect(seen).toEqual([
      { nodes: ['a'], edges: [] },
      { nodes: ['a'], edges: ['ea'] },
      { nodes: ['a'], edges: [] },
    ])
  })

  it('size 返回节点+边合计（向后兼容：只选节点时与原 size 一致）', () => {
    const s = new Selection()
    s.set(['1', '2'])
    expect(s.size).toBe(2)
    s.addEdge('e1')
    expect(s.size).toBe(3)
  })

  it('clearNodes 只清节点桶、clearEdges 只清边桶（细分清理）', () => {
    const s = new Selection()
    s.set(['n1'])
    s.addEdge('e1')
    s.clearNodes()
    expect(s.ids.size).toBe(0)
    expect(s.edgeIds.size).toBe(1)
    s.clearEdges()
    expect(s.edgeIds.size).toBe(0)
  })

  it('脏检查：重复 set 同内容 / add 已存在 / clear 空集不触发 onChange', () => {
    const s = new Selection()
    let calls = 0
    s.onChange(() => (calls += 1))
    s.set(['a', 'b'])
    expect(calls).toBe(1)
    s.set(['a', 'b']) // 同内容 → 不触发
    expect(calls).toBe(1)
    s.add('a') // 已存在 → 不触发
    expect(calls).toBe(1)
    s.clear()
    expect(calls).toBe(2)
    s.clear() // 空集 → 不触发
    expect(calls).toBe(2)
    s.clearNodes() // 已空 → 不触发
    s.clearEdges()
    expect(calls).toBe(2)
  })
})

describe('Selection ids 副本隔离（P1-10）', () => {
  it('外部强转修改 getter 返回的集合不污染内部选中态', () => {
    const sel = new Selection()
    sel.add('a')
    let calls = 0
    sel.onChange(() => { calls += 1 })
    // 强转修改 getter 返回的 Set
    const leaked = sel.ids as unknown as Set<string>
    leaked.add('b')
    // 内部未被污染：has('b') false，且未触发 onChange
    expect(sel.has('b')).toBe(false)
    expect(calls).toBe(0)
  })
})



