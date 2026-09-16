/**
 * 远端变更合并规则单测（纯函数，无 IO）。
 *
 * 这块逻辑决定「AI 改了画布之后，本地怎么跟着变」——做错的代价不是「没同步」，
 * 而是**把用户正在做的东西弄丢**：整包覆盖会冲掉刚建的节点、把正在编辑的内容换掉。
 *
 * 所以这里用三方合并（base=我上次同步时的样子 / mine=本地现在 / theirs=云端现在），
 * 逐个 id 判断，而不是粗暴 replaceAll。核心不变量见各条用例名。
 */
import { describe, it, expect } from 'vitest'
import { planRemoteMerge, type CanvasGraphSnapshot } from '../remoteMerge'

const node = (id: string, x = 0, data: Record<string, unknown> = {}) => ({
  id,
  type: 'text',
  position: { x, y: 0 },
  data,
})
const edge = (id: string, source: string, target: string) => ({ id, source, target })
const snap = (nodes: unknown[], edges: unknown[] = []): CanvasGraphSnapshot => ({
  nodes: nodes as CanvasGraphSnapshot['nodes'],
  edges: edges as CanvasGraphSnapshot['edges'],
})

describe('planRemoteMerge —— AI 的改动要落到本地', () => {
  it('云端新增的节点 → 加进本地', () => {
    const base = snap([node('a')])
    const mine = snap([node('a')])
    const theirs = snap([node('a'), node('ai-1', 500)])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.addNodes.map((n) => n.id)).toEqual(['ai-1'])
    expect(plan.removeNodeIds).toEqual([])
    expect(plan.updateNodes).toEqual([])
  })

  it('云端改过的节点 → 覆盖本地那一份', () => {
    const base = snap([node('a', 0, { text: '旧' })])
    const mine = snap([node('a', 0, { text: '旧' })])
    const theirs = snap([node('a', 0, { text: 'AI 改的' })])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.updateNodes.map((n) => n.id)).toEqual(['a'])
    expect(plan.updateNodes[0].data).toEqual({ text: 'AI 改的' })
  })

  it('云端删掉的节点 → 从本地删（AI 说删就得删，否则会出现「删不掉」）', () => {
    const base = snap([node('a'), node('b')])
    const mine = snap([node('a'), node('b')])
    const theirs = snap([node('b')])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.removeNodeIds).toEqual(['a'])
  })
})

describe('planRemoteMerge —— 本地的东西不能被误伤（这块做错就是丢用户数据）', () => {
  it('本地刚建的节点（云端还没有）→ 保留，不能当成「云端删了」', () => {
    // 这是最容易做错的一条：只看 mine/theirs 的差集，会把用户刚建的节点删掉
    const base = snap([node('a')])
    const mine = snap([node('a'), node('local-new')])
    const theirs = snap([node('a')])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.removeNodeIds).toEqual([])
    expect(plan.addNodes).toEqual([])
    expect(plan.updateNodes).toEqual([])
  })

  it('本地改过、云端没动的节点 → 保留本地改动（不被云端旧值盖回去）', () => {
    const base = snap([node('a', 0, { text: '原来' })])
    const mine = snap([node('a', 0, { text: '我正在改' })])
    const theirs = snap([node('a', 0, { text: '原来' })])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.updateNodes).toEqual([])
    expect(plan.addNodes).toEqual([])
    expect(plan.removeNodeIds).toEqual([])
  })

  it('云端没动过的节点不动它（哪怕本地与 base 一模一样）', () => {
    const base = snap([node('a')])
    const mine = snap([node('a')])
    const theirs = snap([node('a')])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan).toEqual({
      addNodes: [],
      removeNodeIds: [],
      updateNodes: [],
      addEdges: [],
      removeEdgeIds: [],
      updateEdges: [],
    })
  })
})

describe('planRemoteMerge —— 连线', () => {
  it('云端新增/删除连线 → 同步到本地', () => {
    const base = snap([node('a'), node('b'), node('c')], [edge('e1', 'a', 'b')])
    const mine = snap([node('a'), node('b'), node('c')], [edge('e1', 'a', 'b')])
    const theirs = snap([node('a'), node('b'), node('c')], [edge('e2', 'b', 'c')])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.addEdges.map((e) => e.id)).toEqual(['e2'])
    expect(plan.removeEdgeIds).toEqual(['e1'])
  })

  it('端点不存在的连线不往本地加（防悬挂边）', () => {
    // 云端边引用的节点本地没有（例如节点被删了但边还留着）→ 加了也是坏数据
    const base = snap([])
    const mine = snap([node('a')])
    const theirs = snap([node('a')], [edge('e1', 'a', 'ghost')])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.addEdges).toEqual([])
  })
})

describe('planRemoteMerge —— 合并的结果直接决定「加进来能不能显示」', () => {
  it('云端新增的边，若它的节点也在本次新增里 → 一并加', () => {
    const base = snap([])
    const mine = snap([])
    const theirs = snap([node('a'), node('b')], [edge('e1', 'a', 'b')])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.addNodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(plan.addEdges.map((e) => e.id)).toEqual(['e1'])
  })

  it('云端删掉节点时，连在它身上的边也要从本地消失', () => {
    const base = snap([node('a'), node('b')], [edge('e1', 'a', 'b')])
    const mine = snap([node('a'), node('b')], [edge('e1', 'a', 'b')])
    const theirs = snap([node('b')], [])

    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.removeNodeIds).toEqual(['a'])
    expect(plan.removeEdgeIds).toEqual(['e1'])
  })
})

describe('planRemoteMerge —— 边：AI 删了本地也得删（type 必须两边一致）', () => {
  /**
   * 这条对应一个真实 bug：云端存边时没写 type（null），而数据层会给边补 default type（custom）。
   * 两边对同一条边判成「不一样」，于是「云端删了」被误判成「本地把它改过了」，本地就把那条边留了下来。
   */
  it('云端删边、本地没动 → 本地也删', () => {
    const e = { id: 'e1', source: 'a', target: 'b', type: 'custom' }
    const base = snap([node('a'), node('b')], [e])
    const mine = snap([node('a'), node('b')], [e])
    const theirs = snap([node('a'), node('b')], [])
    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.removeEdgeIds).toEqual(['e1'])
  })

  it('云端改了边的 data、本地没动 → 用云端的', () => {
    const before = { id: 'e1', source: 'a', target: 'b', type: 'custom', data: { label: '旧' } }
    const after = { id: 'e1', source: 'a', target: 'b', type: 'custom', data: { label: '新' } }
    const base = snap([node('a'), node('b')], [before])
    const mine = snap([node('a'), node('b')], [before])
    const theirs = snap([node('a'), node('b')], [after])
    const plan = planRemoteMerge(base, mine, theirs)
    expect(plan.updateEdges.map((x) => x.id)).toEqual(['e1'])
    expect(plan.updateEdges[0].data).toEqual({ label: '新' })
  })
})
