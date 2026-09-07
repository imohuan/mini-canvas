import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-core-v2'
import {
  NodeStore,
  EdgeStore,
  Selection,
  History,
  CommandRegistry,
  type CanvasEdge,
} from '@mini-canvas/canvas-core-v2'
import { fileDropPlugin, FileDropServiceImpl, type FileDropService, type FileDropReaders } from '../fileDropPlugin'

/** 测试本地信封形状（与渲染层宿主 GraphEnvelope 同构；避免插件测试依赖 canvas-render） */
interface GraphEnvelope {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown>; size?: { w: number; h: number } }>
  edges: CanvasEdge[]
}

/** 组装带真实内核服务的最小 ctx（含 image/text 类型注册 + edgeStore/history/command 宿主恒在服务） */
function makeCtx() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 300, h: 200 } })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())) as GraphEnvelope['nodes'],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as GraphEnvelope['edges'],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  ctx.inject('history', history)
  const command = new CommandRegistry()
  ctx.inject('command', command)
  return { ctx, nodeStore, edgeStore, selection, history }
}

function makeFile(name: string, type: string, content?: string): File {
  return new File([content ?? ''], name, { type })
}

/** 假浏览器 IO：node 环境无 FileReader/Image/URL.createObjectURL，测试注入确定性实现 */
function fakeReaders(over: Partial<FileDropReaders> = {}): FileDropReaders {
  return {
    readText: async (f) => f.text(),
    readImageDims: async () => ({ width: 2000, height: 1000 }),
    createObjectURL: () => 'blob:mock-url',
    ...over,
  }
}

/** 直接构造服务（不经插件生命周期）：文件读取用假 IO，store 用真实内核 */
function makeService(overReaders: Partial<FileDropReaders> = {}) {
  const { ctx, nodeStore, edgeStore, selection, history } = makeCtx()
  const svc = new FileDropServiceImpl(ctx, fakeReaders(overReaders))
  return { ctx, svc, nodeStore, edgeStore, selection, history }
}

describe('file-drop 插件集成（真实内核服务）', () => {
  it('addFiles 文本文件 → 建 text 节点（读内容 + 截断 + 选中 + 可撤销）', async () => {
    const { svc, nodeStore, selection, history } = makeService()
    const f = makeFile('note.md', 'text/markdown', 'hello file-drop')
    const count = await svc.addFiles([f], { x: 100, y: 100 })
    expect(count).toBe(1)
    const nodes = nodeStore.getNodes()
    expect(nodes.length).toBe(1)
    expect(nodes[0].type).toBe('text')
    expect(nodes[0].position).toEqual({ x: 100, y: 100 })
    expect((nodes[0].data.text as string).startsWith('hello file-drop')).toBe(true)
    // 选中新节点
    expect(selection.ids.has(nodes[0].id)).toBe(true)
    // 可撤销
    expect(history.canUndo()).toBe(true)
    history.undo()
    expect(nodeStore.getNodes().length).toBe(0)
  })

  it('addFiles 图片文件 → 建 image 节点带 objectURL 与适配 size', async () => {
    const { svc, nodeStore } = makeService()
    const f = makeFile('pic.png', 'image/png')
    const count = await svc.addFiles([f], { x: 50, y: 60 })
    expect(count).toBe(1)
    const nodes = nodeStore.getNodes()
    expect(nodes[0].type).toBe('image')
    expect(nodes[0].position).toEqual({ x: 50, y: 60 })
    expect(nodes[0].data.imageUrl).toBe('blob:mock-url')
    // 2000x1000 → 适配 420x210（fitImageSize）
    expect(nodes[0].size).toEqual({ w: 420, h: 210 })
  })

  it('addFiles 多文件级联排布（不重叠）', async () => {
    const { svc, nodeStore } = makeService()
    const a = makeFile('a.png', 'image/png')
    const b = makeFile('b.png', 'image/png')
    const count = await svc.addFiles([a, b], { x: 300, y: 300 })
    expect(count).toBe(2)
    const nodes = nodeStore.getNodes()
    expect(nodes.length).toBe(2)
    expect(nodes[1].position.x - nodes[0].position.x).toBe(40)
    expect(nodes[1].position.y - nodes[0].position.y).toBe(40)
  })

  it('不支持/未注册类型不建节点并返回 0', async () => {
    const { svc, nodeStore } = makeService()
    const before = nodeStore.getNodes().length
    expect(await svc.addFiles([makeFile('v.mp4', 'video/mp4')], { x: 0, y: 0 })).toBe(0)
    expect(nodeStore.getNodes().length).toBe(before)
  })

  it('addPastedText：建 text 节点；空文本返回 null', async () => {
    const { svc, nodeStore } = makeService()
    const id = svc.addPastedText('pasted content', { x: 10, y: 20 })
    expect(id).toBeTruthy()
    const node = nodeStore.getNode(id!)
    expect(node?.type).toBe('text')
    expect(node?.data.text).toBe('pasted content')
    expect(svc.addPastedText('   ', { x: 0, y: 0 })).toBeNull()
  })

  it('canHandle 判断（结合类型注册）', async () => {
    const { svc } = makeService()
    expect(svc.canHandle({ name: 'a.png', type: 'image/png' })).toBe(true)
    expect(svc.canHandle({ name: 'a.md', type: '' })).toBe(true)
    expect(svc.canHandle({ name: 'a.mp4', type: 'video/mp4' })).toBe(false)
  })

  it('无 viewport 服务时以显式 flow 坐标建节点（锚点直接生效）', async () => {
    const { svc, nodeStore } = makeService()
    const id = svc.addPastedText('x', { x: 12, y: 34 })
    expect(nodeStore.getNode(id!)!.position).toEqual({ x: 12, y: 34 })
  })

  it('插件装配（ctx.plugin + start）后服务可经 ctx.get 消费', async () => {
    const { ctx } = makeCtx()
    ctx.plugin(fileDropPlugin)
    await ctx.start()
    const svc = ctx.get<FileDropService>('file-drop')
    // 插件路径用默认浏览器 IO；node 下只测不触发文件读取的服务方法
    expect(svc.canHandle({ name: 'a.md', type: 'text/plain' })).toBe(true)
    expect(svc.addPastedText('p', { x: 0, y: 0 })).toBeTruthy()
  })
})
