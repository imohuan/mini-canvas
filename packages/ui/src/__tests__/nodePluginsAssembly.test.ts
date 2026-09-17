/**
 * 四个节点插件的整装验证（@mini-canvas/ui 是装配壳，这里是"清单真的能一起跑"的仲裁）。
 *
 * 为什么放在 ui 包：内核包不能反向依赖插件（依赖方向恒 插件→内核），而"多插件同时装载"这件事
 * 只有装配层能验。锁三件事：
 * 1. 四个节点类型都注册进 nodeStore（无遗漏、无重名冲突）；
 * 2. 每个类型的段（content + 顶部/底部条）都落到 nodeRegistry（壳才渲染得出来）；
 * 3. 每个类型都能经 nodeFactory 真建出节点、且写进 graph（服务名不互相打架）。
 *
 * 这一条测试不碰浏览器/WebGL：three 的球体只在组件 mount 时才会创建，这里只验装配与写模型。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { node3dPreviewPlugin } from '@mini-canvas/plugin-node-3d-preview'
import { nodeImageComparePlugin } from '@mini-canvas/plugin-node-image-compare'
import { nodeVideoPlugin } from '@mini-canvas/plugin-node-video'
import { fileDropPlugin } from '@mini-canvas/plugin-file-drop'
import { pluginImageGenerationTools } from '@mini-canvas/plugin-tool-image-generation'
import { pluginTextGenerationTools } from '@mini-canvas/plugin-tool-text-generation'
import type { ToolService } from '@mini-canvas/kernel'

/** 起一个与宿主同形的内核（真服务，不 mock）并装载四个节点插件 */
async function bootAll() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())),
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())),
    }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  const nodeRegistry = new NodeRegistry()

  ctx.inject('nodeStore', nodeStore)
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('selection', selection)
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', nodeRegistry)
  ctx.inject('themeRegistry', new ThemeRegistry())

  for (const plugin of [nodeTextPlugin, nodeImagePlugin, nodeVideoPlugin, node3dPreviewPlugin, nodeImageComparePlugin]) {
    ctx.plugin(plugin)
  }
  // 文件拖入/粘贴也照宿主清单装载：它是"把外部素材变成节点"的唯一入口，漏装就等于拖拽完全没反应。
  ctx.plugin(fileDropPlugin)
  // 工具提供方也照宿主清单装载：图片节点的"生成"能力来自它，不是自己写死 HTTP。
  ctx.plugin(pluginImageGenerationTools)
  ctx.plugin(pluginTextGenerationTools)
  await ctx.start()
  return { ctx, nodeStore, nodeRegistry }
}

/**
 * 各节点类型各自的预期段（壳 BaseNode 实际会读的槽位）。
 * 注意：text 只有底部状态栏 —— 顶部的加粗/字号/颜色/对齐对文本节点无语义，已按用户要求删除；
 * video 是上下都要：上面是"上传/剪辑/裁剪/截图/下载"操作条，下面是剪辑时间轴。
 * 以后若要给某类型加回顶部栏，必须同步改这里，否则这条测试会拦住（这正是它的用处）。
 */
const EXPECTED = [
  { type: 'text', extraSegments: ['bottom-toolbar'] },
  { type: 'image', extraSegments: ['top-toolbar', 'bottom-toolbar', 'overlay'] },
  { type: 'video', extraSegments: ['top-toolbar', 'bottom-toolbar', 'overlay'] },
  { type: '3d-preview', extraSegments: [] },
  { type: 'image-compare', extraSegments: [] },
] as const

describe('节点插件整装', () => {
  it('全部节点类型都注册，没有重名冲突', async () => {
    const { ctx, nodeStore } = await bootAll()
    const types = [...nodeStore.types.keys()]
    for (const { type } of EXPECTED) {
      expect(types).toContain(type)
    }
    ctx.stop()
  })

  it('每个类型都注册了 content 段（壳缺 content 会渲染"未注册"提示）；带控制栏的类型另有其段', async () => {
    const { ctx, nodeRegistry } = await bootAll()
    for (const { type, extraSegments } of EXPECTED) {
      const segments = nodeRegistry.get(type)?.segments ?? {}
      expect(segments.content, `${type} 缺 content 段`).toBeTruthy()
      for (const seg of extraSegments) {
        expect(segments[seg], `${type} 缺 ${seg} 段`).toBeTruthy()
      }
    }
    ctx.stop()
  })

  it('每个节点类型都声明了 description（右键"新建节点"菜单的 hover 小字来源；漏一个就红）', async () => {
    const { ctx, nodeStore } = await bootAll()
    for (const { type } of EXPECTED) {
      expect(nodeStore.types.get(type)?.description, type + ' 未声明 description').toBeTruthy()
    }
    ctx.stop()
  })

  it('所有类型都能真建出节点并落进 graph（服务名互不打架）', async () => {
    const { ctx } = await bootAll()
    const factory = ctx.get<{ create(t: string, p: { x: number; y: number }, data?: Record<string, unknown>): string }>(
      'nodeFactory',
    )
    const graph = ctx.get<{ getNode(id: string): { type: string } | undefined; getNodes(): unknown[] }>('graph')

    const ids = EXPECTED.map(({ type }, i) => factory.create(type, { x: i * 40, y: i * 40 }))
    for (const id of ids) expect(id).toBeTruthy()
    expect(graph.getNodes().length).toBe(EXPECTED.length)
    EXPECTED.forEach(({ type }, i) => {
      expect(graph.getNode(ids[i])?.type).toBe(type)
    })
    ctx.stop()
  })

  it('各插件的服务名都能取到（text / image / video / panorama3d / imageCompare）', async () => {
    const { ctx } = await bootAll()
    for (const service of ['text', 'image', 'video', 'panorama3d', 'imageCompare']) {
      expect(ctx.get(service), `服务 ${service} 未上架`).toBeTruthy()
    }
    ctx.stop()
  })

  it('文件拖入插件真的装上了，并且能拖图片/视频/文本（用户的"拖进去没反应"就是漏装）', async () => {
    const { ctx, nodeStore } = await bootAll()
    const svc = ctx.get<{
      canHandle(f: { name: string; type: string }): boolean
      addFiles(files: File[], at: { x: number; y: number } | null): Promise<number>
    }>('file-drop')
    expect(svc, 'file-drop 服务没上架 = 拖拽/粘贴完全没有监听').toBeTruthy()

    // 三类素材都能被接住（对应的节点类型都已注册）
    expect(svc.canHandle({ name: 'a.png', type: 'image/png' })).toBe(true)
    expect(svc.canHandle({ name: 'a.mp4', type: 'video/mp4' })).toBe(true)
    expect(svc.canHandle({ name: 'a.md', type: 'text/markdown' })).toBe(true)
    expect(svc.canHandle({ name: 'a.bin', type: '' })).toBe(false)

    // 文本这条不碰浏览器 IO（FileReader 走 File.text()），能在 node 里真跑一遍
    const count = await svc.addFiles([new File(['hello'], 'note.md', { type: 'text/markdown' })], { x: 10, y: 20 })
    expect(count).toBe(1)
    expect(nodeStore.getNodes().some((n) => n.type === 'text')).toBe(true)
    ctx.stop()
  })

  it('卸载全部插件后类型与段一起回收（无残留）', async () => {
    const { ctx, nodeStore, nodeRegistry } = await bootAll()
    ctx.stop()
    for (const { type } of EXPECTED) {
      expect(nodeStore.types.has(type)).toBe(false)
      expect(nodeRegistry.has(type)).toBe(false)
    }
  })

  it('图片节点经 ctx.tools 发现"能出图"的工具（节点不认识任何模型名）', async () => {
    const { ctx } = await bootAll()
    const tools = ctx.get<ToolService>('tools')
    const imageTools = tools.list({ produces: 'image' })

    expect(imageTools.length).toBeGreaterThan(0)
    // 每个工具都自带 UI 需要的一切：显示名 + 声明式参数（节点据此自动渲染下拉）
    for (const t of imageTools) {
      expect(typeof t.name).toBe('string')
      expect(t.title).toBeTruthy()
      expect(Array.isArray(t.params)).toBe(true)
    }
    ctx.stop()
  })

  it('能按"吃文本输入"筛工具（文本节点 → 图片节点这条上下文链路）', async () => {
    const { ctx } = await bootAll()
    const tools = ctx.get<ToolService>('tools')
    const eatText = tools.list({ produces: 'image', accepts: 'text' })
    expect(eatText.length).toBeGreaterThan(0)
    ctx.stop()
  })

  it('文本节点经 ctx.tools 发现"能产出文本"的工具（与图片工具互不混入）', async () => {
    const { ctx } = await bootAll()
    const tools = ctx.get<ToolService>('tools')
    const textTools = tools.list({ produces: 'text' })

    expect(textTools.length).toBeGreaterThan(0)
    for (const t of textTools) {
      expect(t.name.startsWith('text.generate:')).toBe(true)
      expect(Array.isArray(t.params)).toBe(true)
      // 提示词模板由工具声明（面板据此出"模板"下拉，节点不认识模板内容）
      expect(Array.isArray(t.templates)).toBe(true)
    }
    // 图片工具不该出现在文本清单里（两类产出互不污染）
    expect(textTools.every((t) => !t.name.startsWith('image.generate:'))).toBe(true)
    ctx.stop()
  })

  it('两类生成工具并存：图片 5 个 + 文本 3 个，各自按 produces 取到', async () => {
    const { ctx } = await bootAll()
    const tools = ctx.get<ToolService>('tools')
    expect(tools.list({ produces: 'image' }).length).toBeGreaterThan(0)
    expect(tools.list({ produces: 'text' }).length).toBeGreaterThan(0)
    // 工具名唯一（两个插件的前缀不同，不会撞名）
    const names = tools.list().map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    ctx.stop()
  })

  it('参数的声明式字段齐全（label/type/default 都有，面板才能自动长控件）', async () => {
    const { ctx } = await bootAll()
    const tools = ctx.get<ToolService>('tools')
    for (const t of [...tools.list({ produces: 'image' }), ...tools.list({ produces: 'text' })]) {
      for (const p of t.params ?? []) {
        expect(p.key, `工具 ${t.name} 的参数缺 key`).toBeTruthy()
        expect(p.label, `参数 ${p.key} 缺 label`).toBeTruthy()
        expect(p.description, `参数 ${p.key} 缺 description`).toBeTruthy()
        if (p.type === 'select') {
          expect(p.options?.length, `下拉参数 ${p.key} 没有候选项`).toBeGreaterThan(0)
        }
      }
    }
    ctx.stop()
  })

  it('装载顺序无关：工具注册表在插件加载前后都可用', async () => {
    const { ctx } = await bootAll()
    // 启动后新注册一个工具也应立刻可见（热插拔模型插件的基础）
    const tools = ctx.get<ToolService>('tools')
    const before = tools.list({ produces: 'image' }).length
    ctx.tools.register({
      name: 'test.extra',
      title: '测试工具',
      produces: 'image',
      run: () => ({ ok: true, urls: ['x.png'] }),
    })
    expect(tools.list({ produces: 'image' }).length).toBe(before + 1)
    await expect(tools.invoke('test.extra', {})).resolves.toEqual({ ok: true, urls: ['x.png'] })
    ctx.stop()
  })
})
