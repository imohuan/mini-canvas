/**
 * 可视化节点类型声明的契约：**保留卡片边框**。
 *
 * 由来（2026-10-12 用户口径）：可视化节点是一块白面板，没有边框时与画布背景糊在一起，
 * 用户分不清节点边界在哪。以前这里声明 frameless: true（内容铺满、去掉外壳那圈 1px 缝），
 * 现在不声明 = 走 BaseNode 的默认边框。
 *
 * 边框本来就由**共享外壳**（plugin-theme-canvas 的 BaseNode 的 .v2-card）画，
 * 节点类型只声明"要不要"。这条测试钉住"别又声明回 frameless"。
 */
import { describe, it, expect } from 'vitest'
import { Context, NodeStore, EdgeStore, Selection, History, GraphDocument, createDocService, type DocService } from '@plume-canvas/canvas-data'
import { CommandRegistry } from '@plume-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@plume-canvas/canvas-data'
import { nodeUiPlugin, UI_NODE_TYPE } from '../nodeUiPlugin'

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
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())
  ctx.inject('settings', { get: () => undefined })
  ctx.plugin(nodeUiPlugin)
  return ctx
}

describe('可视化节点类型声明', () => {
  it('不声明 frameless（保留外壳的 1px 卡片边框）', async () => {
    const ctx = boot()
    await ctx.start()
    const def = ctx.get<DocService>('doc').types.get(UI_NODE_TYPE)
    expect(def).toBeTruthy()
    expect(def?.frameless).toBeFalsy()
    ctx.stop()
  })

  /**
   * 用户 2026-11-17：输出类型**不能按节点类型写死**。同一个可视化节点这次算音频、
   * 下次画图片，右侧端口要跟着节点自己的 data.uiOutputType 走。
   */
  it('★ 输出口由节点数据的 uiOutputType 决定；没有/不认识就没有输出口', async () => {
    const ctx = boot()
    await ctx.start()
    const def = ctx.get<DocService>('doc').types.get(UI_NODE_TYPE)
    expect(def?.outputsFromData).toBeTypeOf('function')
    const outputsOf = (data: Record<string, unknown>) => def!.outputsFromData!(data) ?? []
    expect(outputsOf({})).toEqual([])
    expect(outputsOf({ uiOutputType: '' })).toEqual([])
    expect(outputsOf({ uiOutputType: 'nonsense' })).toEqual([])
    expect(outputsOf({ uiOutputType: null })).toEqual([])
    expect(outputsOf({ uiOutputType: 'audio' })).toEqual([{ port: 'source', contentType: 'audio' }])
    expect(outputsOf({ uiOutputType: 'image' })).toEqual([{ port: 'source', contentType: 'image' }])
    // 老节点兼容：字段从没写过、但已有产物 → 按产物扩展名推断一次（否则会突然失去端口）
    expect(outputsOf({ uiOutputUrl: '/api/x/trimmed.mp3' })).toEqual([{ port: 'source', contentType: 'audio' }])
    expect(outputsOf({ uiOutputUrl: '/api/x/a.png' })).toEqual([{ port: 'source', contentType: 'image' }])
    // 但显式清空（字段存在且为空）= 真的没有输出口
    expect(outputsOf({ uiOutputType: '', uiOutputUrl: '/api/x/a.png' })).toEqual([])
    ctx.stop()
  })
})
