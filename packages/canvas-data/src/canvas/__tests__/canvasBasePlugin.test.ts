/**
 * canvasBasePlugin（设计文档 §九 步骤 4）—— 基础插件本身的验收。
 *
 * 锁三件事：
 * 1. **它声明了核心身份**：core: true，且真被内核记下（uninstallPlugin 返回 false、服务仍可用）；
 * 2. **基础服务件件到位**，容器/工厂/命令收在内部运行时；
 * 3. **换一个宿主（headless）能跑通建节点 / 撤销 / 落盘全链** —— 不依赖浏览器，
 *    这就是"步骤 4 完成标准③"的证据：画布能力不再绑死在 createMiniCanvasHost 里。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../context'
import { createCanvasBasePlugin, CANVAS_BASE_PLUGIN_NAME } from '../canvasBasePlugin'
import { MemoryStorageAdapter } from '../../storage/memoryAdapter'
import { GRAPH_EDGES_KEY, GRAPH_KEY } from '../../storage/keys'
import { NodeRegistry } from '../registry/nodeRegistry'
import { canvasRuntime } from '../canvasRuntime'
import type { CanvasNode } from '../../nodeStore'
import type { CanvasEdge } from '../../edgeStore'

/**
 * 最小 headless 宿主：建 ctx → 装基础插件 → start → 恢复上次画布 → 启动配置持久化桥。
 *
 * 注意"恢复图"这一步**属宿主职责**（基础插件只管服务与落盘通道，不知道"首启该种什么"）——
 * 这也是本测试的价值：证明画布全链不需要 createMiniCanvasHost，宿主自己两行就能接起来。
 */
async function bootHeadless(adapter?: MemoryStorageAdapter) {
  const store = adapter ?? new MemoryStorageAdapter()
  const ctx = new Context()
  const base = createCanvasBasePlugin({ adapter: store })
  ctx.plugin(base.plugin)
  await ctx.start()
  await base.services.settingsPersist?.restore()
  const { nodeStore, edgeStore, save } = base.services
  const saved = await save.get<CanvasNode[]>('graph', 'canvas')
  const savedEdges = await save.get<CanvasEdge[]>('graph-edges', 'canvas')
  nodeStore.replaceAll(saved ?? [])
  edgeStore.replaceAll(savedEdges ?? [])
  return { ctx, base, services: base.services }
}

describe('canvasBasePlugin —— 建出来的基础服务', () => {
  it('基础服务只上架 save/doc/resources/selection；其余实例进内部运行时', async () => {
    const { ctx, services } = await bootHeadless()
    const names = ['save', 'doc', 'resources', 'selection'] as const
    for (const n of names) {
      expect(ctx.get(n), n + ' 未注入').toBe(services[n as keyof typeof services])
    }
    // 数据四老名 + 容器/工厂/命令/配置桥退出服务表（Spec 3.1 / D8）
    for (const legacy of ['nodeStore', 'edgeStore', 'graph', 'history', 'nodeRegistry', 'themeRegistry', 'nodeFactory', 'command', 'settingsPersist']) {
      expect(ctx.get(legacy), legacy + ' 不该再是服务名').toBeUndefined()
    }
    // 底层四个实例本身仍在 base.services 上（宿主/渲染层直接持有）
    expect(services.nodeStore).toBeDefined()
    expect(services.edgeStore).toBeDefined()
    expect(services.graph).toBeDefined()
    expect(services.history).toBeDefined()
    // doc 是同一批数据的视图（指向同一实例）
    expect(services.doc.getNodes()).toEqual(services.nodeStore.getNodes())
    // 同一批实例在内部运行时里（宿主持有的字段也指向它）
    expect(canvasRuntime()?.nodeRegistry).toBe(services.nodeRegistry)
    expect(canvasRuntime()?.themeRegistry).toBe(services.themeRegistry)
    expect(canvasRuntime()?.nodeFactory).toBe(services.nodeFactory)
    expect(canvasRuntime()?.command).toBe(services.command)
    // 配置持久化桥（缺省开启）
    expect(canvasRuntime()?.settingsPersist).toBe(services.settingsPersist)
    ctx.stop()
  })

  it('画布通用命令（建节点 / 删 / 撤销 / 重做）已注册，宿主不必再注册', async () => {
    const { ctx, services } = await bootHeadless()
    for (const id of ['command:create-node', 'command:delete', 'command:undo', 'command:redo']) {
      expect(services.command.has(id), id + ' 未注册').toBe(true)
    }
    ctx.stop()
  })

  it('persistSettings: false → 不建桥（宿主能关掉配置持久化）', async () => {
    const ctx = new Context()
    const base = createCanvasBasePlugin({ persistSettings: false })
    ctx.plugin(base.plugin)
    await ctx.start()
    expect(ctx.hasService('settingsPersist')).toBe(false)
    expect(canvasRuntime()?.settingsPersist).toBeUndefined()
    expect(base.services.settingsPersist).toBeUndefined()
    ctx.stop()
  })

  it('宿主传入的 nodeRegistry / themeRegistry 实例被原样采用（CanvasHost 自建实例场景）', async () => {
    const ctx = new Context()
    const ownRegistry = new NodeRegistry()
    const base = createCanvasBasePlugin({ nodeRegistry: ownRegistry })
    ctx.plugin(base.plugin)
    await ctx.start()
    expect(canvasRuntime()?.nodeRegistry).toBe(ownRegistry)
    ctx.stop()
  })
})

describe('canvasBasePlugin —— 核心身份（决策 1）', () => {
  it('声明 core: true，内核据此拒卸：返回 false、服务仍在、fiber 仍 active', async () => {
    const { ctx, services } = await bootHeadless()
    expect(CANVAS_BASE_PLUGIN_NAME).toBe('canvas-base')

    expect(ctx.inspectPlugins().find((p) => p.name === 'canvas-base')?.core).toBe(true)
    expect(ctx.canUninstall('canvas-base')).toEqual({ ok: false, reason: 'core' })

    expect(ctx.uninstallPlugin('canvas-base')).toBe(false)
    // 画布功能不受影响：服务实例仍可取到，仍能用
    expect(ctx.get('doc')).toBe(services.doc)
    expect(canvasRuntime()?.nodeFactory).toBe(services.nodeFactory)
    expect(ctx.fiber('canvas-base')?.stateName).toBe('active')
    ctx.stop()
  })

  it('ctx.stop() 不拦：整体生命周期终结时核心插件正常回收（服务消失、状态回 created）', async () => {
    const { ctx } = await bootHeadless()
    ctx.stop()
    expect(ctx.getState()).toBe('created')
    expect(ctx.listPlugins()).toEqual([])
    expect(ctx.get('doc')).toBeUndefined()
  })
})

describe('canvasBasePlugin —— 依赖它的消费方不被连带回退（决策 1-④）', () => {
  it('业务插件 inject 基础服务 → 未遂卸载基础插件后仍 active、missingDeps 空', async () => {
    const ctx = new Context()
    const base = createCanvasBasePlugin()
    ctx.plugin(base.plugin)
    ctx.plugin({
      name: 'biz',
      inject: ['doc'],
      apply(c) {
        c.effect(() => () => void 0)
      },
    })
    await ctx.start()

    expect(ctx.inspectPlugins().find((p) => p.name === 'biz')?.state).toBe('active')
    expect(ctx.uninstallPlugin('canvas-base')).toBe(false)
    const st = ctx.inspectPlugins().find((p) => p.name === 'biz')!
    expect(st.state).toBe('active')
    expect(st.missingDeps).toEqual([])
    ctx.stop()
  })
})

describe('步骤 4 完成标准③ —— headless 宿主跑通建节点 / 撤销 / 落盘全链', () => {
  it('不依赖浏览器：注册一个节点类型 → 建节点 → 撤销 → 重做 → 刷新恢复', async () => {
    const storage = new MemoryStorageAdapter()
    const { ctx, services } = await bootHeadless(storage)
    const { graph, nodeFactory, command, nodeStore, save, selection } = services

    // 一个"业务插件"注册节点类型与 creator（等价 nodeTextPlugin 的最小形态）
    nodeStore.registerType({ type: 'note', label: '便签', defaultSize: { w: 120, h: 60 } })
    nodeFactory.register('note', (position: { x: number; y: number }) => graph.createNode('note', position, { text: 'hi' }))

    // 建节点（经画布通用命令，与 UI 按钮走同一条路）
    const id = command.execute('command:create-node', { type: 'note', position: { x: 10, y: 20 } }) as string
    expect(nodeStore.getNode(id)?.type).toBe('note')
    expect(nodeStore.getNode(id)?.data.text).toBe('hi')

    // 撤销 → 节点消失；重做 → 回来
    command.execute('command:undo')
    expect(nodeStore.getNode(id)).toBeUndefined()
    command.execute('command:redo')
    expect(nodeStore.getNode(id)).toBeDefined()

    // 删除选中（另一条通用命令）
    selection.set([id])
    command.execute('command:delete')
    expect(nodeStore.getNodes()).toHaveLength(0)
    command.execute('command:undo')
    expect(nodeStore.getNodes()).toHaveLength(1)

    // 落盘：graph（节点）与 graph-edges（边）分存
    const id2 = graph.createNode('note', { x: 200, y: 20 }, { text: 'second' })
    const edgeId = graph.addEdge({ source: id, target: id2, type: 'custom' })
    expect(edgeId).toBeTruthy()
    await save.flush()
    const savedNodes = await storage.get<CanvasNode[]>('canvas:' + GRAPH_KEY)
    expect(savedNodes?.map((n) => n.id)).toEqual([id, id2])
    const savedEdges = await storage.get<CanvasEdge[]>('canvas:' + GRAPH_EDGES_KEY)
    expect(savedEdges).toHaveLength(1)

    ctx.stop()

    // 二次 boot（模拟刷新）：同一存储、全新 ctx → 图恢复
    const { ctx: ctx2, services: s2 } = await bootHeadless(storage)
    expect(s2.nodeStore.getNode(id)?.data.text).toBe('hi')
    expect(s2.nodeStore.getNode(id2)?.data.text).toBe('second')
    expect(s2.edgeStore.getEdges()).toHaveLength(1)
    ctx2.stop()
  })
})

describe('保存 → 刷新恢复：上传/生成写进节点 data 的内嵌资源不能丢', () => {
  /**
   * 用户实测：在画布上传一张图片，刷新后图片不见了。
   *
   * 直接原因：图片上传（plugin-node-image 的 uploadImage / addSourceNode）把 File 读成
   * dataURL 写进 data.imageUrl —— 这是「刷新不丢」的既定做法（见 imageTransform 文件头）。
   * 但落盘前的 sanitizeTransientResourceUrls 会把**超过 64KB 的 dataURL** 当成临时地址删掉，
   * 而上传路径并没有 resourceId 之类的第二份拷贝可供恢复 —— 于是数据被永久丢弃。
   *
   * 这个测试走的是**真实落盘链路**（canvasBasePlugin 的提交回调 → save → 二次 boot 恢复），
   * 而不是 imageOps 里那个自带 commit 回调、绕开 sanitize 的浅接缝。
   */
  it('超过 64KB 的 dataURL（图片上传的产物）落盘后仍在，刷新能恢复', async () => {
    const storage = new MemoryStorageAdapter()
    const { ctx, services } = await bootHeadless(storage)
    services.nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })

    // 一张普通照片转出来的 base64 远大于 64KB
    const dataUrl = 'data:image/png;base64,' + 'A'.repeat(200_000)
    const id = services.graph.createNode('image', { x: 0, y: 0 }, { imageUrl: dataUrl, imageName: 'photo.png' })
    await services.save.flush()

    // 落盘的那一份必须还带着图（它是这张图唯一的拷贝）
    const saved = await storage.get<CanvasNode[]>('canvas:' + GRAPH_KEY)
    expect(saved?.[0]?.data.imageUrl).toBe(dataUrl)
    ctx.stop()

    // 模拟刷新：同一存储、全新 ctx
    const { ctx: ctx2, services: s2 } = await bootHeadless(storage)
    expect(s2.nodeStore.getNode(id)?.data.imageUrl).toBe(dataUrl)
    ctx2.stop()
  })
})
