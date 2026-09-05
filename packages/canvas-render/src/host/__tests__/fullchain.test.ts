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
