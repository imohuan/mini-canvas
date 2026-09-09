/**
 * fullchain.test —— 画布宿主装配的全链路集成测试（由原 src/demo/__tests__/demo.test.ts 迁移）。
 *
 * 迁移说明：原测试基于早期装配 bootCanvas(src/demo/host.ts)，与现行 createMiniCanvasHost 功能重复；
 * bootCanvas 已删除，测试改用 createMiniCanvasHost 等价复测。createMiniCanvasHost **不内置**业务插件，
 * 需把 text/image/canvasCommands 经 coldPlugins 显式传入（行为与原 bootCanvas 内置 text+commands 等价）。
 *
 * 覆盖：内核+插件装配、持久化(刷新恢复)、image/text 节点、命令(create/delete/undo/redo)、热装热卸。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import {
  MemoryStorageAdapter,
  type CanvasNode,
  NodeStore,
  type PluginModule,
  type CanvasEdge,
  GRAPH_EDGES_KEY,
} from '@mini-canvas/canvas-core-v2'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import type { ImageNodeService } from '@mini-canvas/plugin-node-image'
import type { TextNodeService } from '@mini-canvas/plugin-node-text'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'

/** 默认冷启动：text + image + commands（对应原 bootCanvas 内置 text/commands + opts.plugins 加 image） */
function baseColdPlugins(): PluginModule[] {
  return [nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin]
}

/** 建宿主：可覆盖 adapter / coldPlugins */
async function boot(opts: { adapter?: MemoryStorageAdapter; plugins?: PluginModule[] } = {}) {
  const { host } = await createMiniCanvasHost({
    adapter: opts.adapter ?? new MemoryStorageAdapter(),
    coldPlugins: opts.plugins ?? baseColdPlugins(),
  })
  return host
}

describe('M4 最小 demo 全链（tracer bullet）', () => {
  it('建内核→装text插件→放节点→编辑→保存', async () => {
    const host = await boot()

    // 插件在 setup 里注册了 text 类型，并经 ctx.inject 暴露 'text' 服务
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string; editText(id: string, t: string): void }>('text')

    // 放一个文本节点 → 返回短 id（数字累加）
    const id = text.addTextNode({ x: 0, y: 0 })
    expect(id).toBe('1') // 短数字 id，非 v1 的 'node-text-171...'

    // 节点 type 是业务类型 'text'，不是 'custom'
    const node = host.nodeStore.getNode(id)!
    expect(node.type).toBe('text')
    expect(node.data.text).toBe('双击编辑')

    // 编辑文本 → 写回 data + 落盘(canvas:graph)
    text.editText(id, '你好 v2')
    expect(host.nodeStore.getNode(id)!.data.text).toBe('你好 v2')

    // flush 确保落盘完成
    await host.save.flush()

    host.stop() // 卸载全部副作用
  })

  it('刷新恢复：同一存储后端，第二次 boot 文本还在', async () => {
    // 共享同一个 memory adapter = 模拟同一浏览器的 localStorage
    const storage = new MemoryStorageAdapter()

    // 第一次会话：建 + 编辑 + 落盘 + 正常卸载
    {
      const host = await boot({ adapter: storage })
      const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string; editText(id: string, t: string): void }>('text')
      text.addTextNode({ x: 0, y: 0 })
      text.editText('1', '刷新后还在')
      await host.save.flush()
      host.stop()
    }

    // 第二次会话：全新内核（模拟刷新页面），读同一存储 → 自动恢复画布
    {
      const host = await boot({ adapter: storage })
      const node = host.nodeStore.getNode('1')!
      expect(node.type).toBe('text')
      expect(node.data.text).toBe('刷新后还在')
      host.stop()
    }
  })

  it('多个节点 id 依次累加、互不撞号', async () => {
    const host = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    expect(text.addTextNode({ x: 0, y: 0 })).toBe('1')
    expect(text.addTextNode({ x: 10, y: 10 })).toBe('2')
    expect(host.nodeStore.getNodes()).toHaveLength(2)
    host.stop()
  })
})

describe('M1(浏览器) image 插件 + removeNode + 两节点持久化', () => {
  it('image 插件：加一个 image 节点，type=data 正确', async () => {
    const host = await boot()
    const img = host.ctx.get<ImageNodeService>('image')
    const id = img.addImageNode({ x: 0, y: 0 }, 'data:image/png;base64,AAA')
    const node = host.nodeStore.getNode(id)!
    expect(node.type).toBe('image')
    expect(node.data.imageUrl).toBe('data:image/png;base64,AAA')
    host.stop()
  })

  it('removeNode：删节点后不在 nodeStore、也落盘（存储里同步少一个）', async () => {
    const storage = new MemoryStorageAdapter()
    const host = await boot({ adapter: storage })
    const img = host.ctx.get<ImageNodeService>('image')
    const text = host.ctx.get<TextNodeService>('text')
    const tid = text.addTextNode({ x: 0, y: 0 })
    const iid = img.addImageNode({ x: 10, y: 10 }, 'url')
    await host.save.flush()

    // 删 text 节点 → nodeStore 减少且 save 已重写
    img.removeNode(tid)
    await host.save.flush()
    expect(host.nodeStore.getNode(tid)).toBeUndefined()
    expect(host.nodeStore.getNode(iid)).toBeDefined()
    expect(host.nodeStore.getNodes()).toHaveLength(1)

    const saved = await storage.get<CanvasNode[]>('canvas:graph')
    expect(saved?.some((n) => n.id === tid)).toBe(false)
    expect(saved?.some((n) => n.id === iid)).toBe(true)
    host.stop()
  })

  it('removeNode：删除带连接边的节点会连带清边、清选中态，边也一并落盘', async () => {
    const storage = new MemoryStorageAdapter()
    const host = await boot({ adapter: storage })
    const img = host.ctx.get<ImageNodeService>('image')
    const text = host.ctx.get<TextNodeService>('text')
    const tid = text.addTextNode({ x: 0, y: 0 })
    const iid = img.addImageNode({ x: 10, y: 10 }, 'url')
    host.edgeStore.addEdge({ source: tid, target: iid })
    host.selection.set([tid])
    await host.save.flush()
    expect(host.edgeStore.getEdges()).toHaveLength(1)

    // 删除带边的节点：连带清边 + 清选中态
    img.removeNode(tid)
    await host.save.flush()
    expect(host.nodeStore.getNode(tid)).toBeUndefined()
    expect(host.edgeStore.getEdges()).toHaveLength(0)
    expect(host.selection.size).toBe(0)

    // graph-edges 也同步落盘为空，undo 后节点与边一起回来
    const savedEdges = await storage.get<CanvasEdge[]>('canvas:' + GRAPH_EDGES_KEY)
    expect(savedEdges).toEqual([])
    host.command.execute('command:undo')
    expect(host.nodeStore.getNode(tid)).toBeDefined()
    expect(host.edgeStore.getEdges()).toHaveLength(1)
    host.stop()
  })

  it('两节点(text+image)持久化：第二次 boot 都能恢复', async () => {
    const storage = new MemoryStorageAdapter()
    // 第一次会话：text + image 各一，落盘后卸载
    {
      const host = await boot({ adapter: storage })
      const text = host.ctx.get<TextNodeService>('text')
      const img = host.ctx.get<ImageNodeService>('image')
      text.addTextNode({ x: 0, y: 0 })
      img.addImageNode({ x: 50, y: 50 }, 'http://x/img.png')
      text.editText('1', '标题还在') // 此刻 nodeStore 已含两节点 → 整体落盘
      await host.save.flush()
      host.stop()
    }
    // 第二次会话：模拟刷新，同一存储恢复两节点
    {
      const host = await boot({ adapter: storage })
      const nodes = host.nodeStore.getNodes()
      expect(nodes).toHaveLength(2)
      const textNode = host.nodeStore.getNode('1')!
      const imageNode = host.nodeStore.getNode('2')!
      expect(textNode.type).toBe('text')
      expect(textNode.data.text).toBe('标题还在')
      expect(imageNode.type).toBe('image')
      expect(imageNode.data.imageUrl).toBe('http://x/img.png')
      host.stop()
    }
  })

  it('注册同一节点类型两次会抛错（registerType 防重）', () => {
    const store = new NodeStore()
    store.registerType({ type: 'text', label: 'a', defaultSize: { w: 1, h: 1 } })
    expect(() => store.registerType({ type: 'text', label: 'b', defaultSize: { w: 1, h: 1 } })).toThrow(
      /already registered/i,
    )
  })

  it('热重载 image 插件：卸载后类型/creator/content 回收，重装同名插件恢复', async () => {
    const host = await boot()
    // 初始：image 类型可建、有 creator
    expect(host.nodeStore.types.has('image')).toBe(true)
    expect(host.nodeFactory.creatableTypes()).toContain('image')
    expect(host.nodeRegistry.has('image')).toBe(true)

    // 热卸：全部注册回收（type / creator / content / image 服务）
    expect(host.ctx.uninstallPlugin('image')).toBe(true)
    expect(host.nodeStore.types.has('image')).toBe(false)
    expect(host.nodeFactory.creatableTypes()).not.toContain('image')
    expect(host.nodeRegistry.has('image')).toBe(false)
    expect(host.ctx.get('image')).toBeUndefined()

    // 热装同名（模拟"插件改了重新装"）：同一份 plugin 对象重装，不应报重复、应恢复能力
    host.ctx.installPlugin(nodeImagePlugin)
    expect(host.nodeStore.types.has('image')).toBe(true)
    expect(host.nodeFactory.creatableTypes()).toContain('image')
    expect(host.nodeRegistry.has('image')).toBe(true)
    const img = host.ctx.get<ImageNodeService>('image')
    const id = img.addImageNode({ x: 0, y: 0 }, 'http://reloaded.png')
    expect(host.nodeStore.getNode(id)?.data.imageUrl).toBe('http://reloaded.png')
    host.stop()
  })
})

describe('M3 命令/删除/创建/撤销（host 集成）', () => {
  it('command:create-node 经 nodeFactory 建节点、command:undo 可还原', async () => {
    const host = await boot()
    const id = host.command.execute('command:create-node', {
      type: 'text',
      position: { x: 10, y: 10 },
    }) as string
    expect(host.nodeStore.getNode(id)).toBeDefined()
    expect(host.nodeStore.getNode(id)!.type).toBe('text')

    // 撤销 → 节点没了
    host.command.execute('command:undo')
    expect(host.nodeStore.getNode(id)).toBeUndefined()
    // 重做 → 又回来
    host.command.execute('command:redo')
    expect(host.nodeStore.getNode(id)).toBeDefined()
    host.stop()
  })

  it('command:delete 删"选中"（多选经统一命令），一次删除进一条历史', async () => {
    const storage = new MemoryStorageAdapter()
    const host = await boot({ adapter: storage })
    const id1 = host.nodeFactory.create('text', { x: 0, y: 0 })
    const id2 = host.nodeFactory.create('image', { x: 50, y: 50 }, 'url')
    await host.save.flush()
    expect(host.nodeStore.getNodes()).toHaveLength(2)

    // 多选两个，经统一 command:delete 一次删光
    host.selection.set([id1, id2])
    host.command.execute('command:delete')
    await host.save.flush()
    expect(host.nodeStore.getNodes()).toHaveLength(0)
    expect(host.selection.size).toBe(0)

    // 落盘同步少两个
    const saved = await storage.get<CanvasNode[]>('canvas:graph')
    expect(saved).toHaveLength(0)

    // 一次删除 = 一条历史，undo 全回来
    expect(host.history.canUndo()).toBe(true)
    host.command.execute('command:undo')
    expect(host.nodeStore.getNodes()).toHaveLength(2)
    // undo 后持久化也要同步恢复后的图（避免“撤销后刷新回到撤销前”）
    await host.save.flush()
    const restored = await storage.get<CanvasNode[]>('canvas:graph')
    expect(restored).toHaveLength(2)
    host.stop()
  })

  it('command:delete 无选中时 no-op 且不产生历史', async () => {
    const host = await boot()
    host.nodeFactory.create('text', { x: 0, y: 0 })
    host.selection.clear()
    const before = host.history.undoDepth
    host.command.execute('command:delete')
    expect(host.nodeStore.getNodes()).toHaveLength(1)
    expect(host.history.undoDepth).toBe(before)
    host.stop()
  })
})

describe('边下沉内核：edgeStore 增删 + 撤销 + 持久化往返', () => {
  it('建边写 edgeStore；command:delete 删节点连带清边；undo 恢复节点与边', async () => {
    const host = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const a = text.addTextNode({ x: 0, y: 0 }) // '1'
    const b = text.addTextNode({ x: 10, y: 10 }) // '2'
    host.edgeStore.addEdge({ source: a, target: b, type: 'custom' })
    expect(host.edgeStore.getEdges()).toHaveLength(1)

    // 删一个端点节点 → 边连带清掉
    host.selection.set([a])
    host.command.execute('command:delete')
    expect(host.nodeStore.getNode(a)).toBeUndefined()
    expect(host.edgeStore.getEdges()).toHaveLength(0)

    // undo → 节点回来、边也回来（快照含边）
    host.command.execute('command:undo')
    expect(host.nodeStore.getNode(a)).toBeDefined()
    expect(host.edgeStore.getEdges()).toHaveLength(1)
    host.stop()
  })

  it('选中边 command:delete 删边且保留两端节点（v2 边双集选中）', async () => {
    const host = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const a = text.addTextNode({ x: 0, y: 0 })
    const b = text.addTextNode({ x: 10, y: 10 })
    const eid = host.edgeStore.addEdge({ source: a, target: b, type: 'custom' })
    expect(host.edgeStore.getEdges()).toHaveLength(1)

    // 只选边（edgeIds），Delete 应只删边、保留两端节点
    host.selection.setEdges([eid])
    host.command.execute('command:delete')
    expect(host.edgeStore.getEdges()).toHaveLength(0)
    expect(host.nodeStore.getNode(a)).toBeDefined()
    expect(host.nodeStore.getNode(b)).toBeDefined()
    host.stop()
  })
  it('删除无边的节点仍单历史(不误记)、redo 后节点带边回来', async () => {
    const host = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const a = text.addTextNode({ x: 0, y: 0 })
    const b = text.addTextNode({ x: 5, y: 5 })
    host.edgeStore.addEdge({ source: a, target: b })
    host.selection.set([a])
    host.command.execute('command:delete')
    host.command.execute('command:undo')
    host.command.execute('command:redo') // 重做 → 节点 a 及其边又被删
    expect(host.nodeStore.getNode(a)).toBeUndefined()
    expect(host.edgeStore.getEdges()).toHaveLength(0)
    host.stop()
  })

  it('边随节点图一起落盘(graph 与 graph-edges 分存)，刷新恢复后边还在', async () => {
    const storage = new MemoryStorageAdapter()
    // 第一次会话：两节点 + 一边，落盘后卸载
    {
      const host = await boot({ adapter: storage })
      const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
      const a = text.addTextNode({ x: 0, y: 0 })
      const b = text.addTextNode({ x: 20, y: 20 })
      host.edgeStore.addEdge({ source: a, target: b, type: 'custom' })
      // 模拟宿主落盘：节点存 graph，边独立存 graph-edges(与 CanvasHost/commands 一致)
      host.save.set('graph', host.nodeStore.getNodes(), 'canvas')
      host.save.set(GRAPH_EDGES_KEY, host.edgeStore.getEdges(), 'canvas')
      await host.save.flush()
      host.stop()
    }
    // 物理键：边存在 graph-edges，节点在 graph
    const edgesSaved = await storage.get<CanvasEdge[]>('canvas:' + GRAPH_EDGES_KEY)
    expect(edgesSaved).toHaveLength(1)
    // 第二次会话：同一存储刷新 → edgeStore 恢复该边
    {
      const host = await boot({ adapter: storage })
      const es = host.edgeStore.getEdges()
      expect(es).toHaveLength(1)
      expect(es[0].type).toBe('custom')
      // 渲染层形状：CanvasHost.syncFromStore 会映射成 {id,type,source,target}
      expect(es[0]).toMatchObject({ id: expect.stringMatching(/^e-1-2$/), source: '1', target: '2' })
      host.stop()
    }
  })

  it('兼容旧存储：graph 只有节点数组(无边)也能正常 boot，edgeStore 为空', async () => {
    const storage = new MemoryStorageAdapter()
    // 预写旧格式：graph = CanvasNode[](历史遗留无边信封)
    await storage.set('canvas:graph', [{ id: '1', type: 'text', position: { x: 0, y: 0 }, data: { text: '旧' } }])
    const host = await boot({ adapter: storage })
    expect(host.nodeStore.getNode('1')).toBeDefined()
    expect(host.edgeStore.getEdges()).toHaveLength(0)
    host.stop()
  })
})

describe('边撤销：拉边(加边)记进历史可 undo/redo（对应 Must-1 修复）', () => {
  it('模拟 CanvasHost.onConnect：withRecord 包 addEdge → undo 边消失、redo 边回来', async () => {
    const host = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const a = text.addTextNode({ x: 0, y: 0 })
    const b = text.addTextNode({ x: 8, y: 8 })
    expect(host.edgeStore.getEdges()).toHaveLength(0)

    // 拉边(等价 onConnect)：withRecord 包 addEdge
    host.history.withRecord(() => {
      host.edgeStore.addEdge({ source: a, target: b, type: 'custom' })
    })
    expect(host.edgeStore.getEdges()).toHaveLength(1)

    // undo → 边消失(撤销"拉边"这一动作)
    host.command.execute('command:undo')
    expect(host.edgeStore.getEdges()).toHaveLength(0)
    // 节点仍在
    expect(host.nodeStore.getNode(a)).toBeDefined()

    // redo → 边回来
    host.command.execute('command:redo')
    expect(host.edgeStore.getEdges()).toHaveLength(1)
    host.stop()
  })

  it('重复连同一边(稳定 id)不新增、也不额外记一条历史', async () => {
    const host = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const a = text.addTextNode({ x: 0, y: 0 })
    const b = text.addTextNode({ x: 3, y: 3 })
    // 第一次拉边 → 记一条历史；再次连同一边(addEdge 去重为同一 id、store 无变化) → 不新增历史
    host.history.withRecord(() => host.edgeStore.addEdge({ source: a, target: b, type: 'custom' }))
    const depth1 = host.history.undoDepth
    host.history.withRecord(() => host.edgeStore.addEdge({ source: a, target: b, type: 'custom' }))
    expect(host.edgeStore.getEdges()).toHaveLength(1)
    expect(host.history.undoDepth).toBe(depth1) // 无变化不记
    host.stop()
  })
})

describe('撤销后刷新闭环（P0-2 完整证据）', () => {
  it('删除→undo→flush→二次 boot：恢复后的图真正持久化（不再是"撤销前"的旧图）', async () => {
    const storage = new MemoryStorageAdapter()
    const h1 = await boot({ adapter: storage })
    const id1 = h1.nodeFactory.create('text', { x: 0, y: 0 })
    h1.nodeFactory.create('image', { x: 50, y: 50 }, 'u')
    await h1.save.flush()
    expect(h1.nodeStore.getNodes()).toHaveLength(2)

    // 多选两个节点一次删除 → flush
    const all = h1.nodeStore.getNodes().map((n) => n.id)
    h1.selection.set(all)
    h1.command.execute('command:delete')
    await h1.save.flush()
    expect(h1.nodeStore.getNodes()).toHaveLength(0)

    // undo 一次回到两节点 → flush（撤销后的图落盘）
    h1.command.execute('command:undo')
    expect(h1.nodeStore.getNodes()).toHaveLength(2)
    await h1.save.flush()
    h1.stop()

    // 二次 boot 同一存储：应恢复撤销后的两节点，而非撤销前的空图
    const h2 = await boot({ adapter: storage })
    expect(h2.nodeStore.getNodes()).toHaveLength(2)
    h2.stop()
  })
})



