import { describe, it, expect } from 'vitest'
import { applyMergePlan, isRuntimeOnly, diffDataKeys, type DocLike } from '../applyMerge'

/** 记录调用序列的假 doc */
function fakeDoc(nodes: Record<string, { data?: Record<string, unknown> }> = {}) {
  const calls: Array<{ op: string; arg: unknown }> = []
  const doc: DocLike = {
    getNode: (id) => nodes[id],
    removeEdges: (ids) => calls.push({ op: 'removeEdges', arg: ids }),
    removeNodes: (ids) => calls.push({ op: 'removeNodes', arg: ids }),
    addNodes: (inputs) => calls.push({ op: 'addNodes', arg: inputs }),
    updateNode: (id, patch) => calls.push({ op: 'updateNode', arg: { id, patch } }),
    updateNodeRuntime: (id, patch) => calls.push({ op: 'updateNodeRuntime', arg: { id, patch } }),
    connectEdge: (e) => calls.push({ op: 'connectEdge', arg: e }),
    transaction: (_r, fn) => {
      calls.push({ op: 'transaction:begin', arg: null })
      const out = fn()
      calls.push({ op: 'transaction:end', arg: null })
      return out
    },
  }
  return { doc, calls }
}

const empty = {
  addNodes: [] as unknown[],
  removeNodeIds: [] as string[],
  updateNodes: [] as unknown[],
  addEdges: [] as unknown[],
  removeEdgeIds: [] as string[],
  updateEdges: [] as unknown[],
}

describe('判断"只动了运行期状态"', () => {
  it('key 差集', () => {
    expect(diffDataKeys({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual(['b'])
    expect(diffDataKeys({ a: 1 }, { a: 1 })).toEqual([])
  })

  it('只有 runState 变了 → 是运行期帧', () => {
    expect(isRuntimeOnly({ runState: { p: 1 }, text: 'x' }, { runState: { p: 2 }, text: 'x' })).toBe(true)
  })

  it('还动了别的 → 不是（那要进撤销栈）', () => {
    expect(isRuntimeOnly({ runState: { p: 1 }, text: 'x' }, { runState: { p: 2 }, text: 'y' })).toBe(false)
    expect(isRuntimeOnly({ runState: { p: 1 } }, { runState: { p: 2 }, imageUrl: 'a' })).toBe(false)
  })
})

describe('落地一轮合并', () => {
  it('进度帧走 updateNodeRuntime（不进撤销栈），且不触发事务', () => {
    const { doc, calls } = fakeDoc({ n1: { data: { runState: { progress: 1 }, text: 'x' } } })
    applyMergePlan(doc, { ...empty, updateNodes: [{ id: 'n1', data: { runState: { progress: 2 }, text: 'x' } }] })
    expect(calls.map((c) => c.op)).toEqual(['updateNodeRuntime'])
    expect(calls[0].arg).toEqual({ id: 'n1', patch: { data: { runState: { progress: 2 } } } })
  })

  it('作品字段变化走事务（一条撤销记录）', () => {
    const { doc, calls } = fakeDoc({ n1: { data: { imageUrl: 'a' } } })
    applyMergePlan(doc, { ...empty, updateNodes: [{ id: 'n1', data: { imageUrl: 'b' } }] })
    expect(calls[0].op).toBe('transaction:begin')
    expect(calls.some((c) => c.op === 'updateNode')).toBe(true)
    expect(calls.some((c) => c.op === 'updateNodeRuntime')).toBe(false)
  })

  it('混合情况：进度帧不进事务，作品改动进事务', () => {
    const { doc, calls } = fakeDoc({
      n1: { data: { runState: { p: 1 } } },
      n2: { data: { imageUrl: 'a' } },
    })
    applyMergePlan(doc, {
      ...empty,
      updateNodes: [
        { id: 'n1', data: { runState: { p: 2 } } },
        { id: 'n2', data: { imageUrl: 'b' } },
      ],
    })
    const runtimeIdx = calls.findIndex((c) => c.op === 'updateNodeRuntime')
    const txIdx = calls.findIndex((c) => c.op === 'transaction:begin')
    const updateIdx = calls.findIndex((c) => c.op === 'updateNode')
    expect(runtimeIdx).toBeGreaterThanOrEqual(0)
    expect(txIdx).toBeGreaterThan(runtimeIdx)
    expect(updateIdx).toBeGreaterThan(txIdx)
  })

  it('新增 / 删除 / 边都走事务（只有一处写，撤销一次退干净）', () => {
    const { doc, calls } = fakeDoc({})
    applyMergePlan(doc, {
      ...empty,
      addNodes: [{ id: 'new1' }],
      removeNodeIds: ['old'],
      addEdges: [{ id: 'e1' }],
      removeEdgeIds: ['e-old'],
      updateEdges: [{ id: 'e2' }],
    })
    expect(calls.filter((c) => c.op === 'transaction:begin')).toHaveLength(1)
    expect(calls.some((c) => c.op === 'addNodes')).toBe(true)
    expect(calls.some((c) => c.op === 'removeNodes')).toBe(true)
    expect(calls.some((c) => c.op === 'removeEdges')).toBe(true)
    expect(calls.some((c) => c.op === 'connectEdge')).toBe(true)
  })

  it('什么都没变 → 不碰画布（没必要为"没事发生"记一条历史）', () => {
    const { doc, calls } = fakeDoc({})
    applyMergePlan(doc, empty)
    expect(calls).toEqual([])
  })

  it('旧宿主没有关联信息（localEdges/childNodesOf）→ 不换 id，避免留下悬挂引用', () => {
    const { doc, calls } = fakeDoc({ n1: { data: {} } })
    applyMergePlan(doc, { ...empty, reassignNodeIds: [{ from: 'n1', to: '9' }] })
    // 没有任何结构操作：旧宿主宁可保留旧行为，也不能把边/子节点引用改坏
    expect(calls).toEqual([])
  })
})
