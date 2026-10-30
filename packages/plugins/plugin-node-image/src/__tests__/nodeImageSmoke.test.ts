/**
 * node-image smoke：装配 image 节点插件不抛、image 服务与节点类型注册、三段展示注册、六条命令注册。
 *
 * 段注册断言的是"用户看得见的行为"：装了插件之后，图片节点除了内容，还应带顶部操作条与底部状态栏
 * ——壳（BaseNode）只渲染已注册的段，所以"段在不在"直接决定按钮会不会出现。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService, type DocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry, resolveSegment } from '@mini-canvas/canvas-data'
import { nodeImagePlugin } from '../nodeImagePlugin'
import { isCropping } from '../cropSession'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => { nodeStore.replaceAll(g.nodes as never); edgeStore.replaceAll(g.edges as never) },
  })
  // 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(nodeImagePlugin)
  return ctx
}

describe('node-image 装配 smoke', () => {
  /**
   * 视频截图（media.addNode 给 sourceNodeId）会建一条「视频 → 新图片」的边。
   * 输入口若不收 video，连接校验会拒掉这条边 —— 截图出来的图片节点就成了没来历的孤儿。
   */
  it('输入口接受视频：视频截图后 “视频 → 图片” 这条边能落下来', async () => {
    const ctx = boot()
    await ctx.start()
    expect(ctx.get<DocService>('doc').types.get('image')?.inputs?.[0]?.acceptsTypes).toEqual([
      'text',
      'image',
      'video',
    ])
    ctx.stop()
  })

  it('插件可装配启动；image 服务上架、节点类型注册', async () => {
    const ctx = boot()
    await ctx.start()
    expect(ctx.get('image')).toBeTruthy()
    expect(ctx.get<DocService>('doc').types.has('image')).toBe(true)
    // 建一个 image 节点（create 委托 image 服务走 graph）
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('image', { x: 5, y: 6 })
    expect(id).toBeTruthy()
    expect(ctx.get<DocService>('doc').getNodes()).toHaveLength(1)
    ctx.stop()
  })

  it('展示段注册：in + over:inset；上栏改由 nodeToolbar 的默认模式提供', async () => {
    const ctx = boot()
    await ctx.start()
    const registry = ctx.get<NodeRegistry>('nodeRegistry')
    expect(resolveSegment(registry, 'image', 'in')).toBeTruthy()
    expect(resolveSegment(registry, 'image', 'over:inset')).toBeTruthy()
    // 2026-10-29 重构：上栏不再走节点类型的 out:top 段，而是注册成 nodeToolbar 的默认模式 ——
    // 这样「默认 / 裁剪 / 扩展」共用同一条解析链路，不会出现两套栏。
    expect(resolveSegment(registry, 'image', 'out:top')).toBeUndefined()
    expect(resolveSegment(registry, 'image', 'out:bottom')).toBeUndefined()
    // 壳没注册的区域不该凭空多出来
    expect(resolveSegment(registry, 'image', 'title')).toBeUndefined()
    ctx.stop()
  })

  it('media 创建器注册：按 kind=image 路由到 image 节点，只写 resourceId', async () => {
    const ctx = boot()
    await ctx.start()
    const field = ctx.registryOf<{ addNode?: (req: unknown) => string | undefined }>('media/creator')
    expect(field.keys()).toContain('image')
    const creator = field.top('image')?.value
    expect(typeof creator?.addNode).toBe('function')
    const id = creator!.addNode!({ kind: 'image', resourceId: 'res-42', position: { x: 10, y: 20 } })
    expect(id).toBeTruthy()
    const node = ctx.get<DocService>('doc').getNode(id!)!
    expect(node.data.resourceId).toBe('res-42')
    expect(node.data.imageUrl).toBeUndefined()
    ctx.stop()
  })

  it('类型级能力：保留卡片边框（不声明 frameless）', async () => {
    const ctx = boot()
    await ctx.start()
    const def = ctx.get<DocService>('doc').types.get('image')
    // 2026-10-12 用户口径：空图片节点与白底图片会和画布背景糊在一起，必须靠外壳（BaseNode 的 .v2-card）
    // 那圈 1px 边框看出节点边界。以前这里声明 frameless: true（内容贴边、去掉那圈缝），现在不声明。
    // 别改回 true —— 改了图片节点就又变成"看不见边界的一块白"。
    expect(def?.frameless).toBeFalsy()
    ctx.stop()
  })

  it('数据契约：声明 produces.image，且引用字段是 resourceId（不是 URL 字段）', async () => {
    const ctx = boot()
    await ctx.start()
    const def = ctx.get<DocService>('doc').types.get('image')
    expect(def?.produces).toEqual({ image: { kind: 'image', refField: 'resourceId' } })
    ctx.stop()
  })

  it('按资源引用建节点：只写 resourceId 与元数据，不写显示地址', async () => {
    const ctx = boot()
    await ctx.start()
    const svc = ctx.get<{
      addImageNodeFromResource(
        p: { x: number; y: number },
        ref: string,
        meta?: { name?: string; width?: number; height?: number },
      ): string
    }>('image')
    const id = svc.addImageNodeFromResource({ x: 1, y: 2 }, 'res-42', {
      name: '截图.png',
      width: 640,
      height: 360,
    })
    const data = ctx.get<DocService>('doc').getNode(id)!.data
    expect(data.resourceId).toBe('res-42')
    expect(data.imageUrl).toBeUndefined()
    expect(data.imageName).toBe('截图.png')
    expect(data.imageWidth).toBe(640)
    expect(data.imageHeight).toBe(360)
    ctx.stop()
  })

  it('六条图片命令都注册（按钮与命令共用同一批实现）', async () => {
    const ctx = boot()
    await ctx.start()
    const ids = ctx.get<{ list(): Array<{ id: string }> }>('command').list().map((c) => c.id)
    for (const id of ['image:upload', 'image:crop', 'image:crop-confirm', 'image:crop-cancel', 'image:rotate', 'image:download']) {
      expect(ids).toContain(id)
    }
    ctx.stop()
  })

  it('命令写回走 graph：cropCancel/crop 这类节点级命令在缺 nodeId 时安全 no-op', async () => {
    const ctx = boot()
    await ctx.start()
    const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    expect(command.execute('image:crop-cancel', {})).toBe(false)
    expect(command.execute('image:rotate', {})).toBe(false)
    expect(command.execute('image:download', {})).toBe(false)
    ctx.stop()
  })

  it('裁剪会话命令开/关一致：crop 置位、cropCancel 复位', async () => {
    const ctx = boot()
    await ctx.start()
    const command = ctx.get<{ execute(id: string, ...payload: unknown[]): unknown }>('command')
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }): string }>('nodeFactory')
    const id = factory.create('image', { x: 0, y: 0 })
    expect(command.execute('image:crop', { nodeId: id })).toBe(true)
    expect(isCropping(id)).toBe(true)
    expect(command.execute('image:crop-cancel', { nodeId: id })).toBe(true)
    expect(isCropping(id)).toBe(false)
    ctx.stop()
  })

  it('本包 Config 声明进 settings 单一数据源：图片最短边 / 最长边（可调）', async () => {
    const ctx = boot()
    await ctx.start()
    const settings = ctx.get<{
      get(key: string): unknown
      has(key: string): boolean
      groupOf(group: string): Array<{ key: string; schema: { label?: string; min?: number; max?: number } }>
      set(key: string, value: number): boolean
    }>('settings')

    // 键名带本包前缀（内核 settings 全局同一张表、先声明者独占，通用名会跟别的插件打架）
    expect(settings.has('imageCardMinShortSide')).toBe(true)
    expect(settings.has('imageCardMaxLongSide')).toBe(true)
    expect(settings.has('imageFitMaxWidth')).toBe(false)
    expect(settings.get('imageCardMinShortSide')).toBe(120)
    expect(settings.get('imageCardMaxLongSide')).toBe(420)

    // 分组与 label 决定设置面板长在哪、叫什么
    const group = settings.groupOf('布局/图片节点尺寸')
    // 「布局/图片节点尺寸」下现在有四项：默认宽/高（新建节点尺寸）+ 最短边/最长边（换图后缩放）
    expect(group.map((i) => i.key).sort()).toEqual([
      'imageCardMaxLongSide', 'imageCardMinShortSide', 'imageDefaultHeight', 'imageDefaultWidth',
    ])
    expect(group.find((i) => i.key === 'imageCardMinShortSide')?.schema.label).toBe('最短边最小')
    expect(group.find((i) => i.key === 'imageCardMaxLongSide')?.schema.label).toBe('最长边最大')

    // 用户能改，且越界被夹到各自的范围
    expect(settings.set('imageCardMaxLongSide', 600)).toBe(true)
    expect(settings.get('imageCardMaxLongSide')).toBe(600)
    settings.set('imageCardMinShortSide', 5)
    expect(settings.get('imageCardMinShortSide')).toBe(40)
    settings.set('imageCardMaxLongSide', 99999)
    expect(settings.get('imageCardMaxLongSide')).toBe(4000)
    ctx.stop()
  })

  it('设置里的最短边 / 最长边一改，画布上已有图片节点立刻重算（实时生效）', async () => {
    const ctx = boot()
    await ctx.start()
    const doc = ctx.get<DocService>('doc')
    const id = doc.createNode('image', { x: 0, y: 0 }, { imageWidth: 1000, imageHeight: 500, cardWidth: 300, cardHeight: 150 })
    // 基线：300×150 符合当前规则（最长边 420、最短边 120）
    expect(doc.getNode(id)!.size).toEqual({ w: 300, h: 150 })
    // 调到最长边 200 → 立刻变成 200×100
    ctx.settings.set('imageCardMaxLongSide', 200)
    // 最短边仍是 120，所以 2:1 的图按短边撑成 240×120（最长边允许超上限）
    expect(doc.getNode(id)!.size).toEqual({ w: 240, h: 120 })
    // 调到最短边 60 → 240×120 的短边已够，只在最长边 200 内缩成 200×100
    ctx.settings.set('imageCardMinShortSide', 60)
    expect(doc.getNode(id)!.size).toEqual({ w: 200, h: 100 })
    // 调到最短边 150 → 短边撑到 150，最长边跟着到 300（允许超上限）
    ctx.settings.set('imageCardMinShortSide', 150)
    expect(doc.getNode(id)!.size).toEqual({ w: 300, h: 150 })
    ctx.stop()
  })
})
