import { describe, expect, it } from 'vitest'
import {
  internalEdgesOf,
  touchingEdgesOf,
  toClipboardNodes,
  toClipboardEdges,
  makeSnapshot,
  computePasteOffset,
  remapSnapshot,
  defaultIdGenerator,
} from '../clipboardEngine'

const N = (id: string, x: number, y: number, size?: { w: number; h: number }) => ({
  id,
  type: 'text',
  position: { x, y },
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
    expect(out[0]).toEqual({ id: '1', type: 'text', position: { x: 10, y: 20 }, data: { a: { b: 1 } } })
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
      nodes: [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: { label: '1' } }],
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

describe('defaultIdGenerator', () => {
  it('带 oldId-copy 前缀（不与内核数字短 id 撞车）', () => {
    const out = defaultIdGenerator('5')
    expect(out.startsWith('5-copy-')).toBe(true)
  })
})
