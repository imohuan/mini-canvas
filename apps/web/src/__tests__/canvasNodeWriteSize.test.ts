/**
 * 节点尺寸写回 —— 尺寸只存 node.size（用户 2026-11-14 拍板，不再有 data 镜像）。
 *
 * 本测试锁死新的语义：
 *   一次 resize → 只写 node.size → 只记一条历史 → 落盘后刷新仍在。
 */
import { describe, it, expect } from 'vitest'
import { createPlumeHost } from '@plume-canvas/canvas-render'
import { MemoryStorageAdapter, nodeSizePatch, type CanvasNode } from '@plume-canvas/canvas-data'
import { nodeTextPlugin } from '@plume-canvas/plugin-node-text'
import { nodeImagePlugin } from '@plume-canvas/plugin-node-image'
import { splitNodeWritePatch } from '@plume-canvas/canvas-render'

async function boot(adapter = new MemoryStorageAdapter()) {
  const { host } = await createPlumeHost({
    adapter,
    // 命令由宿主自带（registerCanvasCommands），插件只装节点类型
    coldPlugins: [nodeTextPlugin, nodeImagePlugin],
  })
  return { host, adapter }
}

describe('resize 写回：只报 size，镜像自动补', () => {
  it('只给 size（nodeSizePatch）→ 只更新 node.size', async () => {
    const { host } = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const id = text.addTextNode({ x: 0, y: 0 })
    // 建节点即落类型默认尺寸
    expect(host.nodeStore.getNode(id)!.size).toEqual({ w: 300, h: 200 })

    // 一次 resize 落盘：useNodeCardSize 现在只报 size（唯一正身）
    const { data, size } = splitNodeWritePatch(nodeSizePatch(700, 300))
    host.graph.updateNode(id, size !== undefined ? { data, size } : { data })

    const node = host.nodeStore.getNode(id)!
    expect(node.size).toEqual({ w: 700, h: 300 })
    // 尺寸只有一份：data 里不再有 cardWidth/cardHeight
    expect('cardWidth' in node.data).toBe(false)
    expect('cardHeight' in node.data).toBe(false)
    host.stop()
  })

  it('一次 resize 只记一条历史；undo 把尺寸还原', async () => {
    const { host } = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const id = text.addTextNode({ x: 0, y: 0 })
    const depthAfterCreate = host.history.undoDepth

    const { data, size } = splitNodeWritePatch({
      cardWidth: 500,
      cardHeight: 260,
      size: { w: 500, h: 260 },
    })
    host.graph.updateNode(id, size !== undefined ? { data, size } : { data })

    // 只前进一条（若 size 与 data 走两次写入，这里会是 2）
    expect(host.history.undoDepth).toBe(depthAfterCreate + 1)

    host.command.execute('command:undo')
    const reverted = host.nodeStore.getNode(id)!
    expect(reverted.size).toEqual({ w: 300, h: 200 })
    host.stop()
  })

  it('落盘后二次 boot：node.size 还在（刷新不丢）', async () => {
    const storage = new MemoryStorageAdapter()
    const id = '1'
    {
      const { host } = await boot(storage)
      const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
      text.addTextNode({ x: 0, y: 0 })
      const { data, size } = splitNodeWritePatch({
        cardWidth: 640,
        cardHeight: 360,
        size: { w: 640, h: 360 },
      })
      host.graph.updateNode(id, size !== undefined ? { data, size } : { data })
      await host.save.flush()
      host.stop()
    }
    {
      const { host } = await boot(storage)
      const node = host.nodeStore.getNode(id)!
      expect(node.size).toEqual({ w: 640, h: 360 })
      // 落盘内容里也带着 size（不是只在内存）
      const saved = await storage.get<CanvasNode[]>('canvas:graph')
      expect(saved?.find((n) => n.id === id)?.size).toEqual({ w: 640, h: 360 })
      host.stop()
    }
  })

  it('标题重命名那类 patch 不带 size：只写 data，不动 node.size', async () => {
    const { host } = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const id = text.addTextNode({ x: 0, y: 0 })

    const { data, size } = splitNodeWritePatch({ label: '改个名' })
    host.graph.updateNode(id, size !== undefined ? { data, size } : { data })
    expect(host.nodeStore.getNode(id)!.data.label).toBe('改个名')
    expect(host.nodeStore.getNode(id)!.size).toEqual({ w: 300, h: 200 })
    host.stop()
  })
})
