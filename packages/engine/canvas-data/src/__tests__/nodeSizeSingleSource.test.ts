import { describe, it, expect } from 'vitest'
import { NodeStore, nodeSizePatch } from '../nodeStore'
import { createDocService } from '../docService'
import { EdgeStore } from '../edgeStore'
import { Selection } from '../selection'
import { History } from '../history'
import { GraphDocument } from '../graphDocument'

/**
 * 尺寸单一来源契约（用户 2026-11-14 拍板）：
 *   **尺寸只存 node.size**。没有 data.cardWidth/cardHeight 镜像，也不做旧数据兼容。
 *
 * 锁住四件事：
 * 1. 新节点一定有 size（用类型默认尺寸）；
 * 2. 写 size 不产生 data.cardWidth/cardHeight；
 * 3. 写 data 里的同名旧字段不再影响尺寸；
 * 4. 非法尺寸一律拒写。
 */
function makeStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  return s
}

/** 按内容的类型（图片/视频）：建节点不写 size，跟着类型默认值走，等有画面了再写死 */
function makeContentSizedStore(): NodeStore {
  const s = new NodeStore()
  s.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 }, sizeFromContent: true })
  s.registerType({ type: 'text', label: '文本', defaultSize: { w: 100, h: 40 } })
  return s
}

describe('sizeFromContent：没画面时跟随类型默认尺寸（用户 2026-11-18）', () => {
  it('addNode：不写 size（留给默认值，设置面板一改就跟着变）', () => {
    const s = makeContentSizedStore()
    const id = s.addNode('image', { x: 0, y: 0 })
    expect(s.getNode(id)!.size).toBeUndefined()
    // 实际尺寸仍然可读：走默认值
    expect(s.effectiveSize(id)).toEqual({ w: 320, h: 240 })
  })

  it('改类型默认尺寸 → 没有 size 的节点立刻跟着变', () => {
    const s = makeContentSizedStore()
    const id = s.addNode('image', { x: 0, y: 0 })
    s.updateTypeSize('image', { w: 490, h: 310 })
    expect(s.effectiveSize(id)).toEqual({ w: 490, h: 310 })
    // 有自己的尺寸的节点不受影响
    s.updateNode(id, { size: { w: 420, h: 236 } })
    s.updateTypeSize('image', { w: 600, h: 400 })
    expect(s.effectiveSize(id)).toEqual({ w: 420, h: 236 })
  })

  it('addNodes / replaceAll 同样不补 size', () => {
    const s = makeContentSizedStore()
    s.addNodes([{ type: 'image', position: { x: 0, y: 0 } }])
    expect(s.getNodes()[0].size).toBeUndefined()
    s.replaceAll([{ id: '9', type: 'image', position: { x: 0, y: 0 }, data: {} } as never])
    expect(s.getNode('9')!.size).toBeUndefined()
    expect(s.effectiveSize('9')).toEqual({ w: 320, h: 240 })
  })

  it('没声明 sizeFromContent 的类型保持原样（新建即写死默认尺寸）', () => {
    const s = makeContentSizedStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    expect(s.getNode(id)!.size).toEqual({ w: 100, h: 40 })
  })

  it('写 0 / 负数 → 当成“清掉自己的尺寸”（回到跟默认走）', () => {
    const s = makeContentSizedStore()
    const id = s.addNode('image', { x: 0, y: 0 })
    s.updateNode(id, { size: { w: 420, h: 236 } })
    s.updateNode(id, { size: { w: 0, h: 0 } })
    expect(s.getNode(id)!.size).toBeUndefined()
    expect(s.effectiveSize(id)).toEqual({ w: 320, h: 240 })
  })
})

describe('nodeSizePatch：唯一写法', () => {
  it('只给 size', () => {
    expect(nodeSizePatch(700, 300)).toEqual({ size: { w: 700, h: 300 } })
  })
})

describe('新建节点一律带 size（类型默认尺寸）', () => {
  it('addNode 写 size', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    expect(s.getNode(id)!.size).toEqual({ w: 100, h: 40 })
  })

  it('addNodes 没给 size 时也写类型默认尺寸', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 } }])
    expect(s.getNodes()[0].size).toEqual({ w: 100, h: 40 })
  })

  it('addNodes 显式给 size 时用给的', () => {
    const s = makeStore()
    s.addNodes([{ type: 'text', position: { x: 0, y: 0 }, size: { w: 260, h: 180 } }])
    expect(s.getNodes()[0].size).toEqual({ w: 260, h: 180 })
  })

  it('replaceAll 缺 size 的节点补类型默认尺寸', () => {
    const s = makeStore()
    s.replaceAll([{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: {} } as never])
    expect(s.getNode('1')!.size).toEqual({ w: 100, h: 40 })
  })

  it('replaceAll 未注册类型的节点不编造尺寸', () => {
    const s = makeStore()
    s.replaceAll([{ id: '1', type: 'ghost', position: { x: 0, y: 0 }, data: {} } as never])
    expect(s.getNode('1')!.size).toBeUndefined()
  })
})

describe('尺寸只存 size，不写 data 镜像', () => {
  it('updateNode({ size }) 不产生 data.cardWidth/cardHeight', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, nodeSizePatch(700, 300))
    const n = s.getNode(id)!
    expect(n.size).toEqual({ w: 700, h: 300 })
    expect('cardWidth' in n.data).toBe(false)
    expect('cardHeight' in n.data).toBe(false)
  })

  it('清 size（size: undefined）→ size 消失，但不动 data', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, { size: undefined })
    expect(s.getNode(id)!.size).toBeUndefined()
  })

  it('写 data.cardWidth/cardHeight → 尺寸不变（旧字段不再参与）', () => {
    const s = makeStore()
    const id = s.addNode('text', { x: 0, y: 0 })
    s.updateNode(id, { data: { cardWidth: 420, cardHeight: 260 } })
    expect(s.getNode(id)!.size).toEqual({ w: 100, h: 40 })
  })
})

describe('doc.setNodeSize：尺寸的一等入口', () => {
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

  it('设尺寸 → node.size 更新，不写 data 镜像', () => {
    const { doc, nodeStore } = makeDoc()
    const id = doc.createNode('text', { x: 0, y: 0 })
    expect(doc.setNodeSize(id, 1600, 100)).toBe(true)
    const n = nodeStore.getNode(id)!
    expect(n.size).toEqual({ w: 1600, h: 100 })
    expect('cardWidth' in n.data).toBe(false)
  })

  it('非法尺寸一律拒写', () => {
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

describe('doc 语义写方法：标题 / 位置 / 父', () => {
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
