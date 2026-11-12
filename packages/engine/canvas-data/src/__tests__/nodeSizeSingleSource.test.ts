import { describe, it, expect } from 'vitest'
import { NodeStore, nodeSizePatch, nodeSizeOf } from '../nodeStore'
import { createDocService } from '../docService'
import { EdgeStore } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'

/**
 * 尺寸单一来源契约（大改造）：
 *   node.size 是唯一正身，data.cardWidth/cardHeight 是从它生成的镜像。
 *
 * 这组测试锁住三件事：
 * 1. 写 size → 镜像自动补齐（写尺寸的插件不再手拼三件套）；
 * 2. 老数据只写 data.cardWidth/cardHeight → 自动提升为 node.size（迁移）；
 * 3. size 缺席 = 用类型默认尺寸，不在建节点时凭空造一个尺寸。
 */
function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  return s
}

describe('nodeSizePatch：唯一正身写法', () => {
  it('只给 size，不再手拼 cardWidth/cardHeight', () => {
    expect(nodeSizePatch(700, 300)).toEqual({ size: { w: 700, h: 300 } })
  })
})

describe('写 size → 镜像自动补齐', () => {
  it('updateNode({ size }) 后 data.cardWidth/cardHeight 与 size 同值', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, nodeSizePatch(700, 300))
    const n = s.getNode(id)!
    expect(n.size).toEqual({ w: 700, h: 300 })
    expect(n.data.cardWidth).toBe(700)
    expect(n.data.cardHeight).toBe(300)
  })

  it('addNodes 显式给 size → 也顺手镜像', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, id: 'g', size: { w: 260, h: 180 } }])
    const n = s.getNode('g')!
    expect(n.data.cardWidth).toBe(260)
    expect(n.data.cardHeight).toBe(180)
  })

  it('清 size（size: undefined）→ 镜像一并清掉（否则卡片停在旧尺寸）', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, nodeSizePatch(400, 200))
    expect(s.getNode(id)!.data.cardWidth).toBe(400)
    s.updateNode(id, { size: undefined })
    const n = s.getNode(id)!
    expect(n.size).toBeUndefined()
    expect(n.data.cardWidth).toBeUndefined()
    expect(n.data.cardHeight).toBeUndefined()
  })
})

describe('老数据迁移：只写 data 的尺寸被提升为 size', () => {
  it('updateNode({ data: { cardWidth, cardHeight } }) → size 补上', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, { data: { cardWidth: 375, cardHeight: 300 } })
    expect(s.getNode(id)!.size).toEqual({ w: 375, h: 300 })
  })

  it('replaceAll 回填旧存档（只有 data 尺寸）→ size 与镜像都补齐', () => {
    const s = makeStore()
    s.replaceAll([
      { id: '1', type: 'text', position: { x: 0, y: 0 }, data: { cardWidth: 640, cardHeight: 360 } } as never,
    ])
    const n = s.getNode('1')!
    expect(n.size).toEqual({ w: 640, h: 360 })
    expect(n.data.cardWidth).toBe(640)
    expect(n.data.cardHeight).toBe(360)
  })

  it('replaceAll 的非法镜像值（0/NaN）不提升为 size', () => {
    const s = makeStore()
    s.replaceAll([
      { id: '1', type: 'text', position: { x: 0, y: 0 }, data: { cardWidth: 0, cardHeight: Number.NaN } } as never,
    ])
    expect(s.getNode('1')!.size).toBeUndefined()
  })

  it('已有 size 的回填不被 data 覆盖（size 是正身）', () => {
    const s = makeStore()
    s.replaceAll([
      { id: '1', type: 'text', position: { x: 0, y: 0 }, size: { w: 500, h: 500 }, data: { cardWidth: 10, cardHeight: 10 } } as never,
    ])
    expect(s.getNode('1')!.size).toEqual({ w: 500, h: 500 })
    expect(s.getNode('1')!.data.cardWidth).toBe(500)
  })
})

describe('size 缺席 = 用类型默认尺寸（不凭空造尺寸）', () => {
  it('addNode 不写 size，也不镜像', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    expect(s.getNode(id)!.size).toBeUndefined()
    expect(s.getNode(id)!.data.cardWidth).toBeUndefined()
  })

  it('无尺寸的标题改名 patch 不建立 size', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, { data: { label: '新名字' } })
    expect(s.getNode(id)!.size).toBeUndefined()
  })
})

describe('nodeSizeOf：只认正有限数', () => {
  it('正常值 → 尺寸；非法值 → undefined', () => {
    expect(nodeSizeOf({ cardWidth: 300, cardHeight: 200 })).toEqual({ w: 300, h: 200 })
    for (const bad of [0, -1, Number.NaN, Infinity, '300', null, undefined]) {
      expect(nodeSizeOf({ cardWidth: bad, cardHeight: 200 })).toBeUndefined()
      expect(nodeSizeOf({ cardWidth: 300, cardHeight: bad })).toBeUndefined()
    }
    expect(nodeSizeOf(undefined)).toBeUndefined()
  })
})

describe('doc.setNodeSize：改尺寸的一等入口（写 size + 自动镜像）', () => {
  function makeDoc() {
    const nodeStore = new NodeStore()
    nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
    const edgeStore = new EdgeStore()
    const selection = new Selection()
    const history = new History({
      snapshot: () => ({ nodes: nodeStore.getSnapshot(), edges: [] }),
      restore: (s: never) => nodeStore.replaceAll((s as { nodes: never[] }).nodes ?? []),
    })
    const graph = new GraphDocument(nodeStore, edgeStore, selection, history, () => {})
    const doc = createDocService({ nodeStore, edgeStore, graph, history })
    return { doc, nodeStore, history }
  }

  it('设尺寸 → node.size 与 data 镜像都更新', () => {
    const { doc, nodeStore } = makeDoc()
    const id = doc.createNode('text', { x: 0, y: 0 })
    expect(doc.setNodeSize(id, 1600, 100)).toBe(true)
    const n = nodeStore.getNode(id)!
    expect(n.size).toEqual({ w: 1600, h: 100 })
    expect(n.data.cardWidth).toBe(1600)
    expect(n.data.cardHeight).toBe(100)
  })

  it('非法尺寸一律拒写（不污染节点）', () => {
    const { doc, nodeStore } = makeDoc()
    const id = doc.createNode('text', { x: 0, y: 0 })
    doc.setNodeSize(id, 400, 200)
    for (const [w, h] of [
      [0, 200],
      [-5, 200],
      [Number.NaN, 200],
      [400, 0],
    ] as Array<[number, number]>) {
      expect(doc.setNodeSize(id, w, h)).toBe(false)
    }
    // 停在最后一次合法值
    expect(nodeStore.getNode(id)!.size).toEqual({ w: 400, h: 200 })
  })

  it('一次 setNodeSize 只记一条撤销', () => {
    const { doc, history } = makeDoc()
    const id = doc.createNode('text', { x: 0, y: 0 })
    const before = history.undoDepth
    doc.setNodeSize(id, 500, 260)
    expect(history.undoDepth).toBe(before + 1)
  })
})

describe('doc 语义写方法：标题 / 位置 / 父（不逼作者写原始字段）', () => {
  function makeDoc() {
    const nodeStore = new NodeStore()
    nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
    nodeStore.registerType({ type: 'group', label: '分组', defaultSize: { w: 300, h: 200 } })
    const edgeStore = new EdgeStore()
    const selection = new Selection()
    const history = new History({
      snapshot: () => ({ nodes: nodeStore.getSnapshot(), edges: [] }),
      restore: (s: never) => nodeStore.replaceAll((s as { nodes: never[] }).nodes ?? []),
    })
    const graph = new GraphDocument(nodeStore, edgeStore, selection, history, () => {})
    const doc = createDocService({ nodeStore, edgeStore, graph, history })
    return { doc, nodeStore, history }
  }

  it('setNodeLabel：写标题；空串/空白/undefined 清掉', () => {
    const { doc, nodeStore } = makeDoc()
    const id = doc.createNode('text', { x: 0, y: 0 })
    doc.setNodeLabel(id, '  我的标题  ')
    expect(nodeStore.getNode(id)!.data.label).toBe('我的标题')
    doc.setNodeLabel(id, '   ')
    expect(nodeStore.getNode(id)!.data.label).toBeUndefined()
    doc.setNodeLabel(id, '再来')
    doc.setNodeLabel(id, undefined)
    expect(nodeStore.getNode(id)!.data.label).toBeUndefined()
  })

  it('moveNode / moveNodes：写位置（批量一条历史）', () => {
    const { doc, nodeStore, history } = makeDoc()
    const a = doc.createNode('text', { x: 0, y: 0 })
    const b = doc.createNode('text', { x: 10, y: 10 })
    doc.moveNode(a, { x: 120, y: 80 })
    expect(nodeStore.getNode(a)!.position).toEqual({ x: 120, y: 80 })
    const before = history.undoDepth
    doc.moveNodes([
      { id: a, position: { x: 1, y: 2 } },
      { id: b, position: { x: 3, y: 4 } },
    ])
    expect(nodeStore.getNode(a)!.position).toEqual({ x: 1, y: 2 })
    expect(nodeStore.getNode(b)!.position).toEqual({ x: 3, y: 4 })
    expect(history.undoDepth).toBe(before + 1)
  })

  it('setNodeParent：设父 / 解除父', () => {
    const { doc, nodeStore } = makeDoc()
    const g = doc.createNode('group', { x: 0, y: 0 })
    const c = doc.createNode('text', { x: 5, y: 5 })
    doc.setNodeParent(c, g)
    expect(nodeStore.getNode(c)!.parentId).toBe(g)
    doc.setNodeParent(c, undefined)
    expect(nodeStore.getNode(c)!.parentId).toBeUndefined()
  })
})
