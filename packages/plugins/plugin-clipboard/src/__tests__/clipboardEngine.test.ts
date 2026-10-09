import { describe, expect, it } from 'vitest'
import {
  internalEdgesOf,
  touchingEdgesOf,
  toClipboardNodes,
  toClipboardEdges,
  makeSnapshot,
  computePasteOffset,
  remapSnapshot,
  type ClipboardNodeInput,
} from '../clipboardEngine'

const N = (id: string, x: number, y: number, size?: { w: number; h: number }) => ({
  id,
  type: 'text',
  position: { x, y },
  // 顶层节点：绝对坐标 == 自身 position（快照/偏移都按绝对坐标走）
  absPosition: { x, y },
  data: { label: id },
  ...(size ? { size } : {}),
})
const E = (id: string, source: string, target: string) => ({ id, source, target })

describe('internalEdgesOf', () => {
  it('两端都在选中集的边保留（内连边）', () => {
    const edges = [E('a-b', 'a', 'b'), E('b-c', 'b', 'c'), E('c-d', 'c', 'd')]
    const out = internalEdgesOf(edges, new Set(['a', 'b']))
    expect(out.map((e) => e.id)).toEqual(['a-b'])
  })
  it('空选中集返回空', () => {
    expect(internalEdgesOf([E('a-b', 'a', 'b')], new Set())).toEqual([])
  })
})

describe('touchingEdgesOf', () => {
  it('任一端触碰选中集的边都保留', () => {
    const edges = [E('a-b', 'a', 'b'), E('b-c', 'b', 'c'), E('c-d', 'c', 'd')]
    const out = touchingEdgesOf(edges, ['b'])
    expect(out.map((e) => e.id)).toEqual(['a-b', 'b-c'])
  })
})

describe('toClipboardNodes / toClipboardEdges', () => {
  it('剥掉渲染态字段，保留持久化形状，data 深拷贝', () => {
    const raw = [{ id: '1', type: 'text', position: { x: 10, y: 20 }, data: { a: { b: 1 } }, selected: true, dimensions: { width: 300 } }]
    const out = toClipboardNodes(raw as never)
    expect(out[0]).toEqual({
      id: '1',
      type: 'text',
      position: { x: 10, y: 20 },
      absPosition: { x: 10, y: 20 },
      data: { a: { b: 1 } },
    })
    expect(out[0].data).not.toBe(raw[0].data) // 深拷贝
    ;(out[0].data.a as { b: number }).b = 999
    expect((raw[0].data.a as { b: number }).b).toBe(1)
  })
  it('边剥成最小形状，undefined 字段不输出', () => {
    const raw = [{ id: 'e', source: 'a', target: 'b', type: 'custom', sourceHandle: undefined, targetHandle: 't' }]
    expect(toClipboardEdges(raw as never)).toEqual([{ id: 'e', source: 'a', target: 'b', type: 'custom', targetHandle: 't' }])
  })
})

describe('makeSnapshot', () => {
  it('快照节点剥干净 + 带 copyTime', () => {
    const snap = makeSnapshot([N('1', 0, 0)], [], 123)
    expect(snap).toEqual({
      nodes: [{ id: '1', type: 'text', position: { x: 0, y: 0 }, absPosition: { x: 0, y: 0 }, data: { label: '1' } }],
      edges: [],
      copyTime: 123,
    })
  })
})

describe('computePasteOffset', () => {
  it('空快照兜底 50/50', () => {
    expect(computePasteOffset([])).toEqual({ offsetX: 50, offsetY: 50 })
  })
  it('无锚点：级联 50+count*20', () => {
    expect(computePasteOffset([N('1', 0, 0)]).offsetX).toBe(50)
    expect(computePasteOffset([N('1', 0, 0)], null, 2).offsetX).toBe(90)
  })
  it('有锚点：组中心对齐锚点（含默认尺寸 256）', () => {
    // 单节点 (0,0) 尺寸 256 → 中心 (128,128)；锚点 (300,100) → offset (172,-28)
    const out = computePasteOffset([N('1', 0, 0)], { x: 300, y: 100 })
    expect(out).toEqual({ offsetX: 172, offsetY: -28 })
  })
  it('多节点取包围盒中心（含声明尺寸）', () => {
    // a (0,0,w100) b (300,0,w100) → minX=0 maxX=400 中心200；minY=0 maxY=100(h100) 中心50
    const nodes = [N('a', 0, 0, { w: 100, h: 100 }), N('b', 300, 0, { w: 100, h: 100 })]
    expect(computePasteOffset(nodes, { x: 0, y: 0 })).toEqual({ offsetX: -200, offsetY: -50 })
  })
})

describe('remapSnapshot', () => {
  it('节点换新 id + 平移；边按 idMap 重连', () => {
    let n = 0
    const gen = (old: string) => {
      n++
      return 'copy-' + old + '-' + n
    }
    const snap = makeSnapshot(
      [N('a', 0, 0), N('b', 100, 0)],
      [E('ab', 'a', 'b')],
      1,
    )
    const { nodes, edges, idMap } = remapSnapshot(snap, { offsetX: 20, offsetY: 30 }, gen)
    expect(idMap.get('a')).toBe('copy-a-1')
    expect(idMap.get('b')).toBe('copy-b-2')
    expect(nodes.map((x) => x.id)).toEqual(['copy-a-1', 'copy-b-2'])
    expect(nodes[0].position).toEqual({ x: 20, y: 30 })
    expect(nodes[1].position).toEqual({ x: 120, y: 30 })
    expect(edges).toEqual([{ id: 'ab', source: 'copy-a-1', target: 'copy-b-2' }])
  })
  it('父节点在同批选中集时跟随重映射', () => {
    const gen = (old: string) => 'n' + old
    const snap = makeSnapshot(
      [
        { ...N('p', 0, 0), type: 'group' },
        { ...N('c', 10, 10), parentId: 'p' },
      ],
      [],
      1,
    )
    const { nodes } = remapSnapshot(snap, { offsetX: 0, offsetY: 0 }, gen)
    expect(nodes[1].parentId).toBe('np')
  })
  it('父不在同批选中集时剥离 parentId（防悬挂）', () => {
    const gen = (old: string) => 'n' + old
    const snap = makeSnapshot([{ ...N('c', 10, 10), parentId: 'outside' }], [], 1)
    const { nodes } = remapSnapshot(snap, { offsetX: 0, offsetY: 0 }, gen)
    expect(nodes[0].parentId).toBeUndefined()
  })
  it('边端点在 idMap 里缺失则丢弃（防御）', () => {
    const snap = makeSnapshot([N('a', 0, 0)], [E('ab', 'a', 'ghost')], 1)
    const { edges } = remapSnapshot(snap, { offsetX: 0, offsetY: 0 }, (old) => 'x' + old)
    expect(edges).toEqual([])
  })
})

// 用户 2026-10-09 报的缺陷：复制带 parent 的节点 → 位置算错、父子关系像丢了。
// 根因是子节点 position 是**相对父的局部坐标**，被当成绝对坐标混算。
describe('带父子的复制粘贴（绝对坐标 / 相对坐标不混算）', () => {
  /** 组 G 在绝对 (1000,1000)，子 c 相对组 (30,40) → c 绝对 (1030,1040) */
  const grouped = () => {
    const group: ClipboardNodeInput = { id: 'g', type: 'group', position: { x: 1000, y: 1000 }, data: { label: 'G' }, size: { w: 400, h: 300 } }
    const child: ClipboardNodeInput = { id: 'c', type: 'text', position: { x: 30, y: 40 }, data: { label: 'C' }, parentId: 'g' }
    return { group, child }
  }

  it('父与子一起复制：子节点记录绝对坐标，父在批内则保留相对坐标与父引用', () => {
    const { group, child } = grouped()
    const snap = makeSnapshot([group, child], [], 1)
    const g = snap.nodes.find((n) => n.id === 'g')!
    const c = snap.nodes.find((n) => n.id === 'c')!
    expect(g.absPosition).toEqual({ x: 1000, y: 1000 })
    // 子节点绝对坐标 = 父绝对 + 相对，而不是它自己的相对值 30/40
    expect(c.absPosition).toEqual({ x: 1030, y: 1040 })
    expect(c.position).toEqual({ x: 30, y: 40 }) // 局部坐标原样保留
    expect(c.parentId).toBe('g') // 父在批内 → 引用保留
  })

  it('只复制子节点（父未被选中）：用 absProvider 取整张画布的绝对坐标，落顶层不悬挂', () => {
    const { group, child } = grouped()
    const all = new Map([['g', group], ['c', child]])
    const abs = (id: string) => {
      const n = all.get(id)!
      return n.parentId ? { x: n.position.x + all.get(n.parentId)!.position.x, y: n.position.y + all.get(n.parentId)!.position.y } : { x: n.position.x, y: n.position.y }
    }
    const snap = makeSnapshot([child], [], 1, abs)
    expect(snap.nodes[0].absPosition).toEqual({ x: 1030, y: 1040 })
    expect(snap.nodes[0].parentId).toBeUndefined() // 父在批外 → 剥离，防悬挂
  })

  it('整块粘贴：父平移，子节点相对坐标不变（父子关系与相对位置都保住）', () => {
    const { group, child } = grouped()
    const snap = makeSnapshot([group, child], [], 1)
    const { nodes } = remapSnapshot(snap, { offsetX: 100, offsetY: 50 }, (old) => 'n' + old)
    const ng = nodes.find((n) => n.id === 'ng')!
    const nc = nodes.find((n) => n.id === 'nc')!
    // 父按绝对偏移平移
    expect(ng.position).toEqual({ x: 1100, y: 1050 })
    // 子在组内相对位置**一格没动** —— 这正是用户"粘贴后子节点四散"的反例
    expect(nc.position).toEqual({ x: 30, y: 40 })
    expect(nc.parentId).toBe('ng') // 父引用跟随重映射到新 id
  })

  it('父子整体粘贴的包围盒只按根节点算，中心贴锚点（子节点不把包围盒撑偏）', () => {
    const { group, child } = grouped()
    const snap = makeSnapshot([group, child], [], 1)
    // 根 g 绝对 (1000,1000) 尺寸 400x300 → 中心 (1200,1150)；锚点 (1200,1150) → 零偏移
    const offset = computePasteOffset(snap.nodes, { x: 1200, y: 1150 })
    expect(offset).toEqual({ offsetX: 0, offsetY: 0 })
  })
})
