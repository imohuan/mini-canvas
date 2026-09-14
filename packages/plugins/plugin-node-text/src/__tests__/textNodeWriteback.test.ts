/**
 * text 节点写回契约：文本改写要真的落到 data，复制会带走文本，删除能撤销回滚。
 * 全部走内核真实服务（graph/history/nodeStore），不 mock——锁的是"写回路径真的通"。
 *
 * 历史说明：本文件原先还测样式字段（fontWeight/fontSize/textColor/textAlign）与 patchTextData。
 * 用户明确表示文字的"样式"概念对他没有意义，顶部操作条与样式链路已整体删除，
 * 对应用例一并移除；本文件只留"内容（text）+ 复制 + 删除"这条真正在用的路径。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { nodeTextPlugin } from '../nodeTextPlugin'
import type { TextNodeService } from '../nodeTextPlugin'

function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('selection', new Selection())
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
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, ctx.get('selection'), history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.plugin(nodeTextPlugin)
  return ctx
}

describe('text 节点写回', () => {
  it('editText 写进 node.data.text，且可 undo 回滚', async () => {
    const ctx = boot()
    await ctx.start()
    const text = ctx.get<TextNodeService>('text')
    const id = text.addTextNode({ x: 0, y: 0 })
    const graph = ctx.get<GraphDocument>('graph')

    text.editText(id, '改过的内容')
    expect(graph.getNode(id)?.data.text).toBe('改过的内容')

    graph.undo()
    expect(graph.getNode(id)?.data.text).toBe('双击编辑')
    graph.redo()
    expect(graph.getNode(id)?.data.text).toBe('改过的内容')
    ctx.stop()
  })

  it('新建节点只带内容字段，不再写任何样式字段', async () => {
    const ctx = boot()
    await ctx.start()
    const text = ctx.get<TextNodeService>('text')
    const id = text.addTextNode({ x: 0, y: 0 })
    const data = ctx.get<GraphDocument>('graph').getNode(id)?.data ?? {}
    expect(data.text).toBe('双击编辑')
    for (const key of ['fontWeight', 'fontSize', 'textColor', 'textAlign']) {
      expect(data[key]).toBeUndefined()
    }
    ctx.stop()
  })

  it('duplicateTextNode 复制文本，位置右下偏移；源不存在返回空串', async () => {
    const ctx = boot()
    await ctx.start()
    const text = ctx.get<TextNodeService>('text')
    const graph = ctx.get<GraphDocument>('graph')
    const id = text.addTextNode({ x: 100, y: 50 })
    text.editText(id, '原文')

    const copyId = text.duplicateTextNode(id)
    expect(copyId).toBeTruthy()
    const copy = graph.getNode(copyId)
    expect(copy?.type).toBe('text')
    expect(copy?.data.text).toBe('原文')
    expect(copy?.position).toEqual({ x: 124, y: 74 })

    expect(text.duplicateTextNode('不存在')).toBe('')
    ctx.stop()
  })

  it('复制出的节点只带业务字段，不带会话态字段', async () => {
    const ctx = boot()
    await ctx.start()
    const text = ctx.get<TextNodeService>('text')
    const graph = ctx.get<GraphDocument>('graph')
    const id = text.addTextNode({ x: 0, y: 0 })
    // 会话态字段由别处（如 AI 工具）写进 data，复制时不该被带走
    graph.updateNode(id, { data: { _overlay: { crop: true } } })

    const copyId = text.duplicateTextNode(id)
    expect(graph.getNode(copyId)?.data._overlay).toBeUndefined()
    ctx.stop()
  })

  it('text.delete 命令删掉节点，undo 能恢复', async () => {
    const ctx = boot()
    await ctx.start()
    const text = ctx.get<TextNodeService>('text')
    const graph = ctx.get<GraphDocument>('graph')
    const id = text.addTextNode({ x: 0, y: 0 })

    const cmd = ctx.get<{ execute(id: string, ...p: unknown[]): unknown }>('command')
    cmd.execute('text.delete', { nodeId: id })
    expect(graph.getNode(id)).toBeUndefined()

    graph.undo()
    expect(graph.getNode(id)).toBeTruthy()
    ctx.stop()
  })

  it('text.duplicate 命令复制节点；缺 nodeId 时各命令 no-op 返回 false', async () => {
    const ctx = boot()
    await ctx.start()
    const text = ctx.get<TextNodeService>('text')
    const graph = ctx.get<GraphDocument>('graph')
    const cmd = ctx.get<{ execute(id: string, ...p: unknown[]): unknown }>('command')
    const id = text.addTextNode({ x: 0, y: 0 })

    expect(cmd.execute('text.duplicate', { nodeId: id })).toBe(true)
    expect(graph.getNodes().length).toBe(2)

    expect(cmd.execute('text.duplicate', {})).toBe(false)
    expect(cmd.execute('text.delete', {})).toBe(false)
    ctx.stop()
  })
})
