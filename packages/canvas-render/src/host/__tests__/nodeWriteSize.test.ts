/**
 * 节点尺寸写回 —— resize 后 data.cardWidth/Height 与 node.size 必须同时更新（方案 1）。
 *
 * 背景（用户提问"保存宽高的地方逻辑是否正确" + 审查结论）：
 *   resize 原先只写 data.cardWidth/cardHeight，漏了内核正式尺寸字段 node.size，
 *   于是"同一尺寸存两份、正式字段恒空"，布局回退链（实测 > node.size > 类型默认）断在中间。
 *
 * 本测试锁死修好后的语义：
 *   一次 resize → 一个 patch → 同时写 data 与 node.size → 只记一条历史 → 落盘后刷新仍在。
 */
import { describe, it, expect } from 'vitest'
import { createMiniCanvasHost } from '../createMiniCanvasHost'
import { MemoryStorageAdapter, type CanvasNode } from '@mini-canvas/canvas-core-v2'
import { nodeTextPlugin } from '@mini-canvas/plugin-node-text'
import { nodeImagePlugin } from '@mini-canvas/plugin-node-image'
import { canvasCommandsPlugin } from '@mini-canvas/plugin-canvas-commands'
import { splitNodeWritePatch } from '../canvasHostCore'

async function boot(adapter = new MemoryStorageAdapter()) {
  const { host } = await createMiniCanvasHost({
    adapter,
    coldPlugins: [nodeTextPlugin, nodeImagePlugin, canvasCommandsPlugin],
  })
  return { host, adapter }
}

describe('resize 写回：data 与 node.size 一次写全', () => {
  it('一个 patch 同时更新 data.cardWidth/Height 与 node.size', async () => {
    const { host } = await boot()
    const text = host.ctx.get<{ addTextNode(p: { x: number; y: number }): string }>('text')
    const id = text.addTextNode({ x: 0, y: 0 })
    // 建节点时未写 size（nodeStore.addNode 只存 id/type/position/data）
    expect(host.nodeStore.getNode(id)!.size).toBeUndefined()

    // 模拟一次 resize 落盘：BaseNode → nodeWrite → defaultWrite 的同一路径
    const { data, size } = splitNodeWritePatch({
      cardWidth: 700,
      cardHeight: 300,
      size: { w: 700, h: 300 },
    })
    host.graph.updateNode(id, size !== undefined ? { data, size } : { data })

    const node = host.nodeStore.getNode(id)!
    expect(node.size).toEqual({ w: 700, h: 300 })
    expect(node.data.cardWidth).toBe(700)
    expect(node.data.cardHeight).toBe(300)
    host.stop()
  })

  it('一次 resize 只记一条历史；undo 把尺寸与 data 一起还原', async () => {
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
    expect(reverted.size).toBeUndefined()
    expect(reverted.data.cardWidth).toBeUndefined()
    host.stop()
  })

  it('落盘后二次 boot：node.size 与 data.cardWidth 都还在（刷新不丢）', async () => {
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
      expect(node.data.cardWidth).toBe(640)
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
    expect(host.nodeStore.getNode(id)!.size).toBeUndefined()
    host.stop()
  })
})
