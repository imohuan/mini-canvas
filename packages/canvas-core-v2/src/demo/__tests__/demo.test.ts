import { describe, it, expect } from 'vitest'
import { bootCanvas } from '../host'
import { MemoryStorageAdapter } from '../../services/storage/memoryAdapter'
import { nodeImagePlugin } from '../../plugins/nodeImage'
import type { ImageNodeService } from '../../plugins/nodeImage'
import type { TextNodeService } from '../../plugins/nodeText'
import type { CanvasNode } from '../../services/nodeStore'
import { NodeStore } from '../../services/nodeStore'

describe('M4 最小 demo 全链（tracer bullet）', () => {
  it('建内核→装text插件→放节点→编辑→保存', async () => {
    const host = await bootCanvas()

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
      const host = await bootCanvas(storage)
      const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string; editText(id: string, t: string): void }>('text')
      text.addTextNode({ x: 0, y: 0 })
      text.editText('1', '刷新后还在')
      await host.save.flush()
      host.stop()
    }

    // 第二次会话：全新内核（模拟刷新页面），读同一存储 → 自动恢复画布
    {
      const host = await bootCanvas(storage)
      const node = host.nodeStore.getNode('1')!
      expect(node.type).toBe('text')
      expect(node.data.text).toBe('刷新后还在')
      host.stop()
    }
  })

  it('多个节点 id 依次累加、互不撞号', async () => {
    const host = await bootCanvas()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    expect(text.addTextNode({ x: 0, y: 0 })).toBe('1')
    expect(text.addTextNode({ x: 10, y: 10 })).toBe('2')
    expect(host.nodeStore.getNodes()).toHaveLength(2)
    host.stop()
  })
})

describe('M1(浏览器) image 插件 + removeNode + 两节点持久化', () => {
  it('image 插件：加一个 image 节点，type=data 正确', async () => {
    const host = await bootCanvas({ plugins: [nodeImagePlugin] })
    const img = host.ctx.get<ImageNodeService>('image')
    const id = img.addImageNode({ x: 0, y: 0 }, 'data:image/png;base64,AAA')
    const node = host.nodeStore.getNode(id)!
    expect(node.type).toBe('image')
    expect(node.data.imageUrl).toBe('data:image/png;base64,AAA')
    host.stop()
  })

  it('removeNode：删节点后不在 nodeStore、也落盘（存储里同步少一个）', async () => {
    const storage = new MemoryStorageAdapter()
    const host = await bootCanvas({ adapter: storage, plugins: [nodeImagePlugin] })
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
      const host = await bootCanvas({ adapter: storage, plugins: [nodeImagePlugin] })
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
      const host = await bootCanvas({ adapter: storage, plugins: [nodeImagePlugin] })
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
})
