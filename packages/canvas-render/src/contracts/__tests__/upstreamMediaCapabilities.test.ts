/**
 * 标准能力包新增两件：upstream（读上游、可无限向上、可倒推执行顺序）与 media（加媒体的唯一入口）。
 *
 * 锁死的语义：
 * - 上游是**按节点**的视图，能一层层往上读（三层链路、分叉、菱形）；
 * - order() 是"最早依赖在前、当前节点最后"的拓扑序，分叉稳定、环可控；
 * - 默认跳过分组容器与中间态元素；
 * - media.put 只回持久引用（ID），地址只由 resolve 现取；
 * - media.addNode/applyToNode 按 kind 路由到创建器注册场，未注册 = undefined/false，不静默建节点。
 */
import { describe, it, expect, vi } from 'vitest'
import { RegistryImpl } from '@mini-canvas/kernel'
import {
  createStandardCapabilities,
  MEDIA_CREATOR_FIELD,
  type MediaCapability,
  type MediaKindCreator,
  type UpstreamCapability,
} from '../standardCapabilities'

interface TestNode {
  id: string
  type: string
  data?: Record<string, unknown>
}
interface TestEdge {
  source: string
  target: string
  data?: Record<string, unknown>
}

const TYPES = new Map<string, unknown>([
  ['image', { produces: { image: { kind: 'image', refField: 'resourceId' } }, consumes: {} }],
  ['text', { produces: { text: { kind: 'text', valueField: 'text' } }, consumes: {} }],
  ['filter', { consumes: { image: { kind: 'image' } } }],
  ['output', { consumes: { image: { kind: 'image' } } }],
])

/** 最小 ctx：doc + 可选 resources + 可选注册场 */
function ctxOf(input: {
  nodes: TestNode[]
  edges: TestEdge[]
  resources?: { put: (blob: Blob, opts?: unknown) => Promise<string>; resolve: (id: string) => Promise<string | undefined> }
  mediaField?: RegistryImpl<MediaKindCreator>
}) {
  const listeners = new Set<() => void>()
  const doc = {
    getNodes: () => input.nodes,
    getEdges: () => input.edges,
    getNode: (id: string) => input.nodes.find((n) => n.id === id),
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    types: TYPES,
  }
  return {
    ctx: {
      get: (name: string) => {
        if (name === 'doc') return doc
        if (name === 'resources') return input.resources
        return undefined
      },
      registryOf: (kind: string) => {
        if (kind !== MEDIA_CREATOR_FIELD) throw new Error('unexpected field: ' + kind)
        return input.mediaField ?? new RegistryImpl<MediaKindCreator>()
      },
    } as never,
    emitChange: () => {
      for (const fn of listeners) fn()
    },
  }
}

/** 造某节点的上游能力 */
function upstreamOf(
  nodes: TestNode[],
  edges: TestEdge[],
  node: { id: string; type: string },
): UpstreamCapability {
  const ctx = ctxOf({ nodes, edges }).ctx
  const caps = createStandardCapabilities(ctx)
  return caps.upstream({ ...node, ctx } as never) as UpstreamCapability
}

function mediaOf(
  nodes: TestNode[],
  edges: TestEdge[],
  extra: {
    resources?: { put: (blob: Blob, opts?: unknown) => Promise<string>; resolve: (id: string) => Promise<string | undefined> }
    mediaField?: RegistryImpl<MediaKindCreator>
  } = {},
): MediaCapability {
  const ctx = ctxOf({ nodes, edges, ...extra }).ctx
  const caps = createStandardCapabilities(ctx)
  return caps.media({ id: 'n', type: 'image', ctx } as never) as MediaCapability
}

describe('upstream 能力：一层与无限向上', () => {
  it('nodes() 只给直接上游；UpstreamNode 还能继续向上', () => {
    const nodes = [
      { id: 'a', type: 'image', data: { resourceId: 'res-a' } },
      { id: 'b', type: 'filter' },
      { id: 'c', type: 'output' },
    ]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const up = upstreamOf(nodes, edges, { id: 'c', type: 'output' })

    expect(up.nodes().map((n) => n.id)).toEqual(['b'])
    const grand = up.nodes()[0]!.upstream()
    expect(grand.map((n) => n.id)).toEqual(['a'])
    expect(grand[0]!.outputs).toEqual({ image: 'res-a' })
    expect(up.nodes()[0]!.depth()).toBe(1)
    expect(up.nodes()[0]!.ancestors().map((n) => n.id)).toEqual(['a'])
  })

  it('三层链路 order() = [A, B, C]，closure() 与 order() 同序', () => {
    const nodes = [
      { id: 'a', type: 'image', data: { resourceId: 'res-a' } },
      { id: 'b', type: 'filter' },
      { id: 'c', type: 'output' },
    ]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]
    const up = upstreamOf(nodes, edges, { id: 'c', type: 'output' })
    expect(up.order()).toEqual(['a', 'b', 'c'])
    expect(up.closure().map((n) => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('分叉：A、B 都在 C 之前，同层顺序稳定', () => {
    const nodes = [
      { id: 'a', type: 'image' },
      { id: 'b', type: 'image' },
      { id: 'c', type: 'output' },
    ]
    const edges = [
      { source: 'a', target: 'c' },
      { source: 'b', target: 'c' },
    ]
    const order = upstreamOf(nodes, edges, { id: 'c', type: 'output' }).order()
    expect(order).toEqual(['a', 'b', 'c'])
    // 多次调用结果一致（不依赖 Map 迭代顺序）
    expect(upstreamOf(nodes, edges, { id: 'c', type: 'output' }).order()).toEqual(order)
  })

  it('菱形依赖：共同祖先只出现一次，且在两条支路之后、终点之前', () => {
    const nodes = [
      { id: 'a', type: 'image' },
      { id: 'b', type: 'filter' },
      { id: 'c', type: 'filter' },
      { id: 'd', type: 'output' },
    ]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ]
    const order = upstreamOf(nodes, edges, { id: 'd', type: 'output' }).order()
    expect(order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('环：默认跳过回边不死循环；cycle:error 抛错并列出环上节点', () => {
    const nodes = [
      { id: 'a', type: 'filter' },
      { id: 'b', type: 'filter' },
    ]
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]
    const up = upstreamOf(nodes, edges, { id: 'b', type: 'filter' })
    expect(up.order()).toEqual(['a', 'b'])
    expect(() => up.order({ cycle: 'error' })).toThrow(/依赖出现环/)
  })

  it('无上游：空数组 + order 只有自己（不抛）', () => {
    const up = upstreamOf([{ id: 'solo', type: 'text', data: { text: 'hi' } }], [], {
      id: 'solo',
      type: 'text',
    })
    expect(up.nodes()).toEqual([])
    expect(up.closure().map((n) => n.id)).toEqual(['solo'])
    expect(up.order()).toEqual(['solo'])
    expect(up.text()).toBe('')
  })

  it('中间态节点与边默认忽略，includeTransient 才参与', () => {
    const nodes = [
      { id: 'a', type: 'image' },
      { id: 'temp', type: 'image', data: { transient: true } },
      { id: 'c', type: 'output' },
    ]
    const edges = [
      { source: 'temp', target: 'c' },
      { source: 'a', target: 'c', data: { transient: true } },
    ]
    const up = upstreamOf(nodes, edges, { id: 'c', type: 'output' })
    expect(up.nodes()).toEqual([])
    // 打开 includeTransient：占位节点与占位边都参与（它们本来就是一次拖线过程的一部分）
    expect(up.order({ includeTransient: true })).toEqual(['a', 'temp', 'c'])
  })

  it('分组节点默认不当数据源，跨组依赖仍能找到', () => {
    const nodes = [
      { id: 'g', type: 'group' },
      { id: 'a', type: 'image' },
      { id: 'c', type: 'output' },
    ]
    const edges = [
      { source: 'g', target: 'c' },
      { source: 'a', target: 'c' },
    ]
    const up = upstreamOf(nodes, edges, { id: 'c', type: 'output' })
    expect(up.nodes().map((n) => n.id)).toEqual(['a'])
    expect(up.order({ includeGroups: true })).toEqual(['a', 'g', 'c'])
  })
})

describe('upstream 能力：按类型取值', () => {
  const nodes = [
    { id: 'img', type: 'image', data: { resourceId: 'res-img' } },
    { id: 'txt', type: 'text', data: { text: '第一句' } },
    { id: 'txt2', type: 'text', data: { text: '第二句' } },
    { id: 'out', type: 'image', data: {} },
  ]
  const edges = [
    { source: 'img', target: 'out' },
    { source: 'txt', target: 'out' },
    { source: 'txt2', target: 'out' },
  ]

  it('ofType 只看声明了该 kind 产出的节点', () => {
    const up = upstreamOf(nodes, edges, { id: 'out', type: 'image' })
    expect(up.ofType('image').map((n) => n.id)).toEqual(['img'])
    expect(up.ofType('text').map((n) => n.id)).toEqual(['txt', 'txt2'])
    expect(up.ofType('video')).toEqual([])
  })

  it('media(slot) 按本节点 consumes 声明取上游资源引用；没声明槽 = undefined', () => {
    const out = upstreamOf(nodes, edges, { id: 'out', type: 'image' })
    // image 类型没有 consumes 声明 → 不可读（字段在 produces，不在 consumes）
    expect(out.media('image')).toBeUndefined()

    const consumer = upstreamOf(nodes, edges, { id: 'out', type: 'output' })
    expect(consumer.media('image')).toEqual({ kind: 'image', resourceId: 'res-img' })
    expect(consumer.media('nope')).toBeUndefined()
  })

  it('text() 按边序拼接，分隔符可换', () => {
    const up = upstreamOf(nodes, edges, { id: 'out', type: 'output' })
    expect(up.text()).toBe('第一句\n第二句')
    expect(up.text(' / ')).toBe('第一句 / 第二句')
  })

  it('subscribe 转发 doc 订阅，取消后不再回调', () => {
    const fake = ctxOf({ nodes, edges })
    const caps = createStandardCapabilities(fake.ctx)
    const up = caps.upstream({ id: 'out', type: 'output', ctx: fake.ctx } as never) as UpstreamCapability
    const fn = vi.fn()
    const off = up.subscribe(fn)
    fake.emitChange()
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    fake.emitChange()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('media 能力：只存 ID、按 kind 路由', () => {
  const put = vi.fn(async () => 'res-1')
  const resolve = vi.fn(async (id: string) => (id === 'res-1' ? 'blob:fake' : undefined))

  it('put 只回持久引用；不改写成地址', async () => {
    const media = mediaOf([], [], { resources: { put, resolve } })
    const id = await media.put(new Blob(['x']), { kind: 'image' })
    expect(id).toBe('res-1')
    expect(put).toHaveBeenCalledTimes(1)
  })

  it('resolve 转发资源服务；未知 ID 返回 undefined', async () => {
    const media = mediaOf([], [], { resources: { put, resolve } })
    await expect(media.resolve('res-1')).resolves.toBe('blob:fake')
    await expect(media.resolve('nope')).resolves.toBeUndefined()
  })

  it('put 在没有资源服务时明确报错（不静默造一个用不了的引用）', async () => {
    const media = mediaOf([], [])
    await expect(media.put(new Blob(['x']), { kind: 'image' })).rejects.toThrow(/media\.put 不可用/)
  })

  it('addNode 按 kind 路由到创建器；未注册的 kind 返回 undefined', () => {
    const field = new RegistryImpl<MediaKindCreator>()
    const addNode = vi.fn(() => 'n1')
    field.add('image', { addNode })

    const media = mediaOf([], [], { mediaField: field })
    expect(media.addNode('image', 'res-1', { x: 10, y: 20 }, { meta: { name: 'a.png' } })).toBe('n1')
    expect(addNode).toHaveBeenCalledWith({
      kind: 'image',
      resourceId: 'res-1',
      position: { x: 10, y: 20 },
      nodeType: undefined,
      meta: { name: 'a.png' },
    })
    expect(media.addNode('video', 'res-2', { x: 0, y: 0 })).toBeUndefined()
  })

  it('available 只列实现了 addNode 的 kind，并按字典序', () => {
    const field = new RegistryImpl<MediaKindCreator>()
    field.add('video', { addNode: () => 'v' })
    field.add('image', { addNode: () => 'i' })
    field.add('audio', { applyToNode: () => true })
    expect(mediaOf([], [], { mediaField: field }).available()).toEqual(['image', 'video'])
  })

  it('applyToNode 按目标节点 produces 槽取 kind；槽不存在或创建器缺失 = false', () => {
    const field = new RegistryImpl<MediaKindCreator>()
    const applyToNode = vi.fn(() => true)
    field.add('image', { applyToNode })
    const nodes = [{ id: 'n1', type: 'image', data: {} }]
    const media = mediaOf(nodes, [], { mediaField: field })

    expect(media.applyToNode('n1', 'image', 'res-1', { width: 10 })).toBe(true)
    expect(applyToNode).toHaveBeenCalledWith({
      kind: 'image',
      nodeId: 'n1',
      slot: 'image',
      resourceId: 'res-1',
      meta: { width: 10 },
    })
    expect(media.applyToNode('n1', 'text', 'res-1')).toBe(false) // image 类型没有 text 产出槽
    expect(media.applyToNode('missing', 'image', 'res-1')).toBe(false)
  })
})
