/**
 * 四个节点插件的整装验证（@plume-canvas/ui 是装配壳，这里是"清单真的能一起跑"的仲裁）。
 *
 * 为什么放在 ui 包：内核包不能反向依赖插件（依赖方向恒 插件→内核），而"多插件同时装载"这件事
 * 只有装配层能验。锁三件事：
 * 1. 四个节点类型都注册进 nodeStore（无遗漏、无重名冲突）；
 * 2. 每个类型的段（in + 顶部/底部条）都落到 nodeRegistry（壳才渲染得出来）；
 * 3. 每个类型都能经 nodeFactory 真建出节点、且写进 graph（服务名不互相打架）。
 *
 * 这一条测试不碰浏览器/WebGL：three 的球体只在组件 mount 时才会创建，这里只验装配与写模型。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@plume-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService } from '@plume-canvas/canvas-data'
import { CommandRegistry } from '@plume-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@plume-canvas/canvas-data'
import { nodeTextPlugin } from '@plume-canvas/plugin-node-text'
import { nodeImagePlugin } from '@plume-canvas/plugin-node-image'
import { node3dPreviewPlugin } from '@plume-canvas/plugin-node-3d-preview'
import { nodeImageComparePlugin } from '@plume-canvas/plugin-node-image-compare'
import { nodeVideoPlugin } from '@plume-canvas/plugin-node-video'
import { nodeAudioPlugin } from '@plume-canvas/plugin-node-audio'
import { fileDropPlugin } from '@plume-canvas/plugin-file-drop'
import type { ToolService } from '@plume-canvas/kernel'

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

  // 5c：数据那一格只有 doc 一个名字（nodeStore/edgeStore/graph/history 四个老服务名已下线）
  ctx.inject('selection', selection)
  ctx.inject(
    'doc',
    createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }),
  )
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', nodeRegistry)
  ctx.inject('themeRegistry', new ThemeRegistry())

  for (const plugin of [
    nodeTextPlugin,
    nodeImagePlugin,
    nodeVideoPlugin,
    nodeAudioPlugin,
    node3dPreviewPlugin,
    nodeImageComparePlugin,
  ]) {
    ctx.plugin(plugin)
  }
  // 文件拖入/粘贴也照宿主清单装载：它是"把外部素材变成节点"的唯一入口，漏装就等于拖拽完全没反应。
  ctx.plugin(fileDropPlugin)
  // 生成工具已改成后台 provider（<数据根>/providers/web2api-*.js），前端不再装载这两个插件。
  await ctx.start()
  return { ctx, nodeStore, nodeRegistry }
}

/**
 * 各节点类型各自的预期段（壳 BaseNode 实际会读的槽位）。
 * 注意：text 只有底部状态栏 —— 顶部的加粗/字号/颜色/对齐对文本节点无语义，已按用户要求删除；
 * 上控制栏不再走 out:top 段（2026-10-29 重构）：图片/视频/音频都注册成 nodeToolbar 的默认模式。
 * 音频的内容段仍负责波形与播放控件（in）；上传入口在上控制栏（默认模式）。
 * （用户口径 2026-10-14：上传按钮搬到顶部菜单栏，与图片/视频节点对齐。）
 * 以后若要给某类型加回顶部栏，必须同步改这里，否则这条测试会拦住（这正是它的用处）。
 */
const EXPECTED = [
  { type: 'text', extraSegments: [] },
  { type: 'image', extraSegments: ['over:inset'] },
  { type: 'video', extraSegments: ['over:inset'] },
  { type: 'audio', extraSegments: [] },
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

  it('每个类型都注册了 in 段（壳缺 in 会渲染"未注册"提示）；带控制栏的类型另有其段', async () => {
    const { ctx, nodeRegistry } = await bootAll()
    for (const { type, extraSegments } of EXPECTED) {
      const segments = nodeRegistry.get(type)?.segments ?? {}
      expect(segments.in, `${type} 缺 in 段`).toBeTruthy()
      for (const seg of extraSegments) {
        expect(segments[seg], `${type} 缺 ${seg} 段`).toBeTruthy()
      }
    }
    // 2026-10-29 重构：图片/视频/音频的上控制栏不再走节点类型的 out:top 段，
    // 而是注册成 nodeToolbar 的默认模式（同一格解析，默认/功能模式共用一条链路）。
    // 这里锁住「不再注册 out:top」，避免两条渲染入口同时存在。
    for (const type of ['image', 'video', 'audio']) {
      expect(nodeRegistry.get(type)?.segments['out:top'], `${type} 不该再注册 out:top 段`).toBeUndefined()
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
    const graph = ctx.get<{ getNode(id: string): { type: string } | undefined; getNodes(): unknown[] }>('doc')

    const ids = EXPECTED.map(({ type }, i) => factory.create(type, { x: i * 40, y: i * 40 }))
    for (const id of ids) expect(id).toBeTruthy()
    expect(graph.getNodes().length).toBe(EXPECTED.length)
    EXPECTED.forEach(({ type }, i) => {
      expect(graph.getNode(ids[i])?.type).toBe(type)
    })
    ctx.stop()
  })

  it('各插件的服务名都能取到（text / image / video / audio / panorama3d / imageCompare）', async () => {
    const { ctx } = await bootAll()
    for (const service of ['text', 'image', 'video', 'audio', 'panorama3d', 'imageCompare']) {
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

  // 生成工具已移到后台 provider（<数据根>/providers/web2api-*.js），
  // 底栏动作由 cloud-client 从 /api/actions 拉取后注册，ctx.tools 里不再有 image.generate:*
  // / text.generate:* 这两批工具。它们的行为由 cloud-server 的
  // src/__tests__/dataProviderWeb2api.test.ts 覆盖。

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
