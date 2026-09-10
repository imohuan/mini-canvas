import { describe, expect, it } from 'vitest'
import type { ExistingEdge, NodeConnectionDef } from '@mini-canvas/canvas-core-v2'
import {
  CARD_BORDER,
  CARD_PADDING_Y,
  CARD_WIDTH,
  ITEM_HEIGHT,
  addEdgeWhenNodeReady,
  buildConnectionMenuItems,
  connectionMenuCardSize,
  filterConnectableTypes,
  isTempEdge,
  isTempNode,
  placeByPortAnchor,
  portSideOf,
  resolveEdgeEndpoints,
  type ConnectionDropFact,
} from '../connectionMenu'

const src = 'node-a'
const newId = 'node-new'

function fact(sourceHandle: 'source' | 'target'): ConnectionDropFact {
  return { sourceNodeId: src, sourceHandle, flowPosition: { x: 300, y: 200 } }
}

describe('临时态标记', () => {
  it('isTempNode / isTempEdge 只认 data.isTemp', () => {
    expect(isTempNode({ data: { isTemp: true } })).toBe(true)
    expect(isTempNode({ data: {} })).toBe(false)
    expect(isTempNode(undefined)).toBe(false)
    expect(isTempEdge({ data: { isTemp: true } })).toBe(true)
    expect(isTempEdge({ data: {} })).toBe(false)
    expect(isTempEdge(undefined)).toBe(false)
  })
})

describe('portSideOf', () => {
  it('从输出口拖出 → 新节点输入口在左缘', () => {
    expect(portSideOf(fact('source'))).toBe('left')
  })
  it('从输入口反向拖出 → 新节点输出口在右缘', () => {
    expect(portSideOf(fact('target'))).toBe('right')
  })
})

describe('placeByPortAnchor（核心不变量：松手点 = 连接端口位置）', () => {
  const anchor = { x: 500, y: 300 }
  const size = connectionMenuCardSize(2)

  it('端口在左缘：左缘竖直中点 = 松手点', () => {
    const p = placeByPortAnchor(anchor, size, 'left')
    expect({ x: p.x, y: p.y + size.h / 2 }).toEqual(anchor)
  })
  it('端口在右缘：右缘竖直中点 = 松手点', () => {
    const p = placeByPortAnchor(anchor, size, 'right')
    expect({ x: p.x + size.w, y: p.y + size.h / 2 }).toEqual(anchor)
  })
  it('换真节点尺寸：端口仍落在松手点，不跳位', () => {
    const nodeSize = { w: 300, h: 200 }
    const p = placeByPortAnchor(anchor, nodeSize, 'left')
    expect({ x: p.x, y: p.y + nodeSize.h / 2 }).toEqual(anchor)
  })
})

describe('connectionMenuCardSize', () => {
  it('高度 = 内边距 + 边框 + 项数×行高（与卡片 CSS 严格对应）', () => {
    expect(connectionMenuCardSize(2)).toEqual({
      w: CARD_WIDTH,
      h: CARD_PADDING_Y + 2 * CARD_BORDER + 2 * ITEM_HEIGHT,
    })
  })
  it('项数 0 按 1 行算（不塌成 0 高）', () => {
    expect(connectionMenuCardSize(0).h).toBe(CARD_PADDING_Y + 2 * CARD_BORDER + ITEM_HEIGHT)
  })
})

describe('resolveEdgeEndpoints', () => {
  it('从输出口拖出：源节点 → 新节点（新节点用 target 口）', () => {
    expect(resolveEdgeEndpoints(fact('source'), newId)).toEqual({
      source: src,
      target: newId,
      sourceHandle: 'source',
      targetHandle: 'target',
    })
  })
  it('从输入口反向拖出：新节点 → 源节点（新节点改用 source 口）', () => {
    expect(resolveEdgeEndpoints(fact('target'), newId)).toEqual({
      source: newId,
      target: src,
      sourceHandle: 'source',
      targetHandle: 'target',
    })
  })
})

describe('buildConnectionMenuItems', () => {
  it('addEdgeAfterTick：先等一帧，再连边（VueFlow 要求节点先于边进内部 store）', async () => {
    const order: string[] = []
    const edgeId = await addEdgeWhenNodeReady({
      waitTick: async () => {
        order.push('tick')
      },
      isNodeReady: () => true,
      isAlive: () => true,
      addEdge: () => {
        order.push('edge')
        return 'e-1'
      },
    })
    expect(order).toEqual(['tick', 'edge'])
    expect(edgeId).toBe('e-1')
  })

  it('addEdgeAfterTick：节点期间已消失（取消/撤销）→ 不连边，返回 null', async () => {
    let called = false
    const edgeId = await addEdgeWhenNodeReady({
      waitTick: async () => {},
      isNodeReady: () => true,
      isAlive: () => false,
      addEdge: () => {
        called = true
        return 'e-1'
      },
    })
    expect(called).toBe(false)
    expect(edgeId).toBeNull()
  })

  it('addEdgeWhenNodeReady：节点前两帧还没就绪 → 一直等到就绪才连边（不丢线）', async () => {
    let ticks = 0
    let ready = false
    const edgeId = await addEdgeWhenNodeReady({
      waitTick: async () => {
        ticks += 1
        if (ticks >= 3) ready = true
      },
      isNodeReady: () => ready,
      isAlive: () => true,
      addEdge: () => 'e-1',
    })
    expect(ticks).toBe(3)
    expect(edgeId).toBe('e-1')
  })

  it('addEdgeWhenNodeReady：量测始终不就绪 → 重试用尽后仍尝试一次（不白丢线）', async () => {
    let called = 0
    const edgeId = await addEdgeWhenNodeReady({
      waitTick: async () => {},
      isNodeReady: () => false,
      isAlive: () => true,
      addEdge: () => {
        called += 1
        return 'e-1'
      },
      maxTries: 3,
    })
    expect(called).toBe(1)
    expect(edgeId).toBe('e-1')
  })

  it('addEdgeWhenNodeReady：重试用尽但节点已消失 → 不连边', async () => {
    let called = false
    const edgeId = await addEdgeWhenNodeReady({
      waitTick: async () => {},
      isNodeReady: () => false,
      isAlive: () => false,
      addEdge: () => {
        called = true
        return 'e-1'
      },
      maxTries: 2,
    })
    expect(called).toBe(false)
    expect(edgeId).toBeNull()
  })

  it('按传入顺序生成新建节点项', () => {
    const items = buildConnectionMenuItems([
      { type: 'text', label: '文本' },
      { type: 'image', label: '图片' },
    ])
    expect(items.map((i) => i.id)).toEqual(['create-node:text', 'create-node:image'])
    expect(items.map((i) => i.label)).toEqual(['文本', '图片'])
    expect(items.every((i) => i.kind === 'create-node' && i.group === 'create')).toBe(true)
  })
  it('无候选 → 空菜单（调用方据此不放临时节点）', () => {
    expect(buildConnectionMenuItems([])).toEqual([])
  })
})

describe('filterConnectableTypes', () => {
  const defs: Record<string, NodeConnectionDef> = {
    text: {
      inputs: [{ port: 'target', acceptsTypes: ['text'], capacity: 1 }],
      outputs: [{ port: 'source', contentType: 'text' }],
    },
    image: {
      inputs: [{ port: 'target', acceptsTypes: ['text', 'image'], capacity: 1 }],
      outputs: [{ port: 'source', contentType: 'image' }],
    },
  }
  const getTypeConn = (type: string): NodeConnectionDef | undefined => defs[type]
  const candidates = [
    { type: 'text', label: '文本' },
    { type: 'image', label: '图片' },
  ]
  const noEdges: ExistingEdge[] = []

  it('从文本输出口拖出：文本/图片都收文本，均可建', () => {
    const out = filterConnectableTypes({ fact: fact('source'), sourceNodeType: 'text', types: candidates, edges: noEdges, getTypeConn })
    expect(out.map((t) => t.type)).toEqual(['text', 'image'])
  })
  it('从图片输出口拖出：文本节点不收图片 → 被滤掉', () => {
    const out = filterConnectableTypes({ fact: fact('source'), sourceNodeType: 'image', types: candidates, edges: noEdges, getTypeConn })
    expect(out.map((t) => t.type)).toEqual(['image'])
  })
  it('从文本输入口反向拖出：新图片节点产图片、文本节点不收 → 只剩文本', () => {
    const out = filterConnectableTypes({ fact: fact('target'), sourceNodeType: 'text', types: candidates, edges: noEdges, getTypeConn })
    expect(out.map((t) => t.type)).toEqual(['text'])
  })
  it('反向拖出且目标输入口已满额（capacity=1 已有入边）→ 全部滤掉', () => {
    const edges: ExistingEdge[] = [{ source: 'node-x', target: src, targetHandle: 'target' }]
    const out = filterConnectableTypes({ fact: fact('target'), sourceNodeType: 'text', types: candidates, edges, getTypeConn })
    expect(out).toEqual([])
  })
  it('源节点类型未知：退化为只看新节点侧声明，不炸', () => {
    const out = filterConnectableTypes({ fact: fact('source'), sourceNodeType: undefined, types: candidates, edges: noEdges, getTypeConn })
    expect(out.map((t) => t.type)).toEqual(['text', 'image'])
  })
})
