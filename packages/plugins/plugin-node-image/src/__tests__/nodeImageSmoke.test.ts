/**
 * node-image smoke：装配 image 节点插件不抛、image 服务与节点类型注册、三段展示注册、六条命令注册。
 *
 * 段注册断言的是"用户看得见的行为"：装了插件之后，图片节点除了内容，还应带顶部操作条与底部状态栏
 * ——壳（BaseNode）只渲染已注册的段，所以"段在不在"直接决定按钮会不会出现。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry, resolveSegment } from '@mini-canvas/canvas-data'
import { nodeImagePlugin } from '../nodeImagePlugin'
import { isCropping } from '../cropSession'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => { nodeStore.replaceAll(g.nodes as never); edgeStore.replaceAll(g.edges as never) },
  })
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(nodeImagePlugin)
  return ctx
}

describe('node-image 装配 smoke', () => {
  it('插件可装配启动；image 服务上架、节点类型注册', async () => {
    const ctx = boot()
    await ctx.start()
    expect(ctx.get('image')).toBeTruthy()
    expect(ctx.get<{ types: Map<string, unknown> }>('nodeStore').types.has('image')).toBe(true)
    // 建一个 image 节点（create 委托 image 服务走 graph）
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('image', { x: 5, y: 6 })
    expect(id).toBeTruthy()
    expect(ctx.get<{ getNodes(): Array<{ id: string; type: string }> }>('nodeStore').getNodes()).toHaveLength(1)
    ctx.stop()
  })

  it('三段展示都注册：content + top-toolbar + bottom-toolbar', async () => {
    const ctx = boot()
    await ctx.start()
    const registry = ctx.get<NodeRegistry>('nodeRegistry')
    expect(resolveSegment(registry, 'image', 'content')).toBeTruthy()
    expect(resolveSegment(registry, 'image', 'top-toolbar')).toBeTruthy()
    expect(resolveSegment(registry, 'image', 'bottom-toolbar')).toBeTruthy()
    // 壳没注册的段不该凭空多出来
    expect(resolveSegment(registry, 'image', 'title')).toBeUndefined()
    ctx.stop()
  })

  it('六条图片命令都注册（按钮与命令共用同一批实现）', async () => {
    const ctx = boot()
    await ctx.start()
    const ids = ctx.get<{ list(): Array<{ id: string }> }>('command').list().map((c) => c.id)
    for (const id of ['image.upload', 'image.crop', 'image.cropConfirm', 'image.cropCancel', 'image.rotate', 'image.download']) {
      expect(ids).toContain(id)
    }
    ctx.stop()
  })

  it('命令写回走 graph：cropCancel/crop 这类节点级命令在缺 nodeId 时安全 no-op', async () => {
    const ctx = boot()
    await ctx.start()
    const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    expect(command.execute('image.cropCancel', {})).toBe(false)
    expect(command.execute('image.rotate', {})).toBe(false)
    expect(command.execute('image.download', {})).toBe(false)
    ctx.stop()
  })

  it('裁剪会话命令开/关一致：crop 置位、cropCancel 复位', async () => {
    const ctx = boot()
    await ctx.start()
    const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('image', { x: 0, y: 0 })
    expect(command.execute('image.crop', { nodeId: id })).toBe(true)
    expect(isCropping(id)).toBe(true)
    expect(command.execute('image.cropCancel', { nodeId: id })).toBe(true)
    expect(isCropping(id)).toBe(false)
    ctx.stop()
  })

  it('本包 Config 声明进 settings 单一数据源：图片预览上限宽/高（默认 420×300，可调）', async () => {
    const ctx = boot()
    await ctx.start()
    const settings = ctx.get<{
      get(key: string): unknown
      has(key: string): boolean
      groupOf(group: string): Array<{ key: string; schema: { label?: string; min?: number; max?: number } }>
      set(key: string, value: number): boolean
    }>('settings')

    // 键名带本包前缀（内核 settings 全局同一张表、先声明者独占，通用名会跟别的插件打架）
    expect(settings.has('imageFitMaxWidth')).toBe(true)
    expect(settings.has('imageFitMaxHeight')).toBe(true)
    expect(settings.get('imageFitMaxWidth')).toBe(420)
    expect(settings.get('imageFitMaxHeight')).toBe(300)

    // 分组与 label 决定设置面板长在哪、叫什么
    const group = settings.groupOf('布局/图片节点尺寸')
    expect(group.map((i) => i.key).sort()).toEqual(['imageFitMaxHeight', 'imageFitMaxWidth'])
    expect(group.find((i) => i.key === 'imageFitMaxWidth')?.schema.label).toBe('图片预览上限宽')
    expect(group.find((i) => i.key === 'imageFitMaxHeight')?.schema.label).toBe('图片预览上限高')

    // 用户能改，且越界被夹到 120-2000
    expect(settings.set('imageFitMaxWidth', 600)).toBe(true)
    expect(settings.get('imageFitMaxWidth')).toBe(600)
    settings.set('imageFitMaxWidth', 5)
    expect(settings.get('imageFitMaxWidth')).toBe(120)
    settings.set('imageFitMaxWidth', 99999)
    expect(settings.get('imageFitMaxWidth')).toBe(2000)
    ctx.stop()
  })
})
