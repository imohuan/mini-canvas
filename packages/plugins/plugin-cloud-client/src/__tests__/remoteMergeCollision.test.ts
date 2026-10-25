import { describe, expect, it } from 'vitest'
import { planRemoteMerge, type CanvasGraphSnapshot, type MergeNode } from '../remoteMerge'
import { applyMergePlan, type DocLike } from '../applyMerge'

const node = (id: string, text: string): MergeNode => ({
  id,
  type: 'text',
  position: { x: 0, y: 0 },
  data: { text },
})

const snap = (nodes: MergeNode[]): CanvasGraphSnapshot => ({ nodes, edges: [] })

describe('同 id 碰撞：本地未提交节点 vs 云端新节点', () => {
  it('本地从未提交的节点换新 id；云端节点正常接入，两边内容都保留', () => {
    const mine = [node('1', '本地正在画')]
    const theirs = [node('1', '云端新节点')]
    const plan = planRemoteMerge(snap([]), snap(mine), snap(theirs))

    expect(plan.reassignNodeIds).toHaveLength(1)
    const moved = plan.reassignNodeIds[0]
    expect(moved.from).toBe('1')
    expect(moved.to).not.toBe('1')
    // 云端节点必须被接入（旧实现这里直接 continue，整条丢掉）
    expect(plan.addNodes.map((n) => n.id)).toEqual(['1'])
    expect(plan.addNodes[0].data.text).toBe('云端新节点')
  })

  it('本地已提交过的同 id 不换号：按普通两边修改规则处理', () => {
    const base = [node('1', '旧内容')]
    const mine = [node('1', '我改的')]
    const theirs = [node('1', '他改的')]
    const plan = planRemoteMerge(snap(base), snap(mine), snap(theirs))
    expect(plan.reassignNodeIds).toEqual([])
    expect(plan.addNodes).toEqual([])
    expect(plan.updateNodes).toHaveLength(1)
  })

  it('本地没有的云端新增不换号（正常新增）', () => {
    const plan = planRemoteMerge(snap([]), snap([]), snap([node('1', '云端')]))
    expect(plan.reassignNodeIds).toEqual([])
    expect(plan.addNodes.map((n) => n.id)).toEqual(['1'])
  })

  it('缺失 position 不被伪造成 0,0：无位置与在原点仍能区分', () => {
    const noPosition = { id: '1', type: 'text', data: { text: 'no-pos' } }
    const atOrigin = { id: '1', type: 'text', position: { x: 0, y: 0 }, data: { text: 'at-origin' } }
    const plan = planRemoteMerge(
      { nodes: [], edges: [] },
      { nodes: [noPosition as MergeNode], edges: [] },
      { nodes: [atOrigin], edges: [] },
    )
    // 本地旧节点没有位置、云端同 id 有位置：两者不是同一份，必须进入碰撞处理而不是静默当成同一个。
    expect(plan.reassignNodeIds).toHaveLength(1)
    expect(plan.addNodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('落地时连线端点与子节点 parentId 跟着换，不留悬挂引用', () => {
    const local = node('1', '本地')
    const child = { ...node('2', '子节点'), parentId: '1' }
    const plan = planRemoteMerge(
      snap([]),
      snap([local, child]),
      snap([node('1', '云端')]),
    )
    expect(plan.reassignNodeIds).toHaveLength(1)
    const movedTo = plan.reassignNodeIds[0].to

    const calls: Array<{ op: string; arg: unknown }> = []
    const doc: DocLike = {
      getNode: (id) => (id === '1' ? local : id === '2' ? child : undefined),
      localEdges: () => [],
      childNodesOf: (id) => (id === '1' ? [{ id: '2' }] : []),
      removeEdges: (ids) => calls.push({ op: 'removeEdges', arg: ids }),
      removeNodes: (ids) => calls.push({ op: 'removeNodes', arg: ids }),
      addNodes: (nodes) => calls.push({ op: 'addNodes', arg: nodes }),
      updateNode: (id, patch) => calls.push({ op: 'updateNode', arg: { id, patch } }),
      updateNodeRuntime: () => {},
      connectEdge: (e) => calls.push({ op: 'connectEdge', arg: e }),
      transaction: (_r, fn) => fn(),
    }
    applyMergePlan(doc, plan)

    // 本地节点用新 id 加回（保留内容），旧 id 被删
    expect(calls).toContainEqual({ op: 'removeNodes', arg: ['1'] })
    expect(calls.some((c) => c.op === 'addNodes' && JSON.stringify(c.arg).includes(movedTo))).toBe(true)
    // 子节点 parentId 指向新 id
    expect(calls).toContainEqual({ op: 'updateNode', arg: { id: '2', patch: { parentId: movedTo } } })
  })
})
