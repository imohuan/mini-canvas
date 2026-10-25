import { describe, expect, it } from 'vitest'
import { planRemoteMerge, isPlanEmpty, type CanvasGraphSnapshot, type MergeNode } from '../remoteMerge'
import { applyMergePlan, type DocLike } from '../applyMerge'

const node = (id: string, data: Record<string, unknown>): MergeNode => ({
  id,
  type: 'text',
  position: { x: 0, y: 0 },
  data,
})

const snap = (nodes: MergeNode[]): CanvasGraphSnapshot => ({ nodes, edges: [] })

describe('远端删除 data 字段', () => {
  it('远端删了、本地没改 → 生成 dataUnset；合并计划不会因此为空', () => {
    const base = snap([node('1', { text: 'x', oldKey: 'gone' })])
    const mine = snap([node('1', { text: 'x', oldKey: 'gone' })])
    const theirs = snap([node('1', { text: 'x' })])
    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.unsetDataKeys).toEqual({ '1': ['oldKey'] })
    expect(isPlanEmpty(plan)).toBe(false)
  })

  it('本地改过同一字段 → 不删（保留本地编辑）', () => {
    const base = snap([node('1', { text: 'x', oldKey: 'gone' })])
    const mine = snap([node('1', { text: 'x', oldKey: 'mine' })])
    const theirs = snap([node('1', { text: 'x' })])
    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.unsetDataKeys).toEqual({})
  })

  it('落地时用显式的 dataUnset 删除，不只把旧值遮过去', () => {
    const calls: Array<{ op: string; arg: unknown }> = []
    const doc: DocLike = {
      getNode: () => ({ data: { text: 'x', oldKey: 'gone' } }),
      removeEdges: (ids) => calls.push({ op: 'removeEdges', arg: ids }),
      removeNodes: (ids) => calls.push({ op: 'removeNodes', arg: ids }),
      addNodes: (nodes) => calls.push({ op: 'addNodes', arg: nodes }),
      updateNode: (id, patch) => calls.push({ op: 'updateNode', arg: { id, patch } }),
      updateNodeRuntime: () => {},
      connectEdge: () => {},
      transaction: (_r, fn) => fn(),
    }
    applyMergePlan(doc, {
      addNodes: [],
      removeNodeIds: [],
      updateNodes: [{ id: '1', data: { text: 'x' } }],
      addEdges: [],
      removeEdgeIds: [],
      updateEdges: [],
      unsetDataKeys: { '1': ['oldKey'] },
    })
    const patch = (calls.find((c) => c.op === 'updateNode')?.arg as { patch: { dataUnset?: string[] } })?.patch
    expect(patch?.dataUnset).toEqual(['oldKey'])
  })
})
