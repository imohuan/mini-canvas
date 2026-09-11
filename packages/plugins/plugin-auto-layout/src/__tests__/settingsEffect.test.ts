import { describe, expect, it } from 'vitest'
import {
  Context,
  NodeStore,
  EdgeStore,
  Selection,
  History,
  CommandRegistry,
  GraphDocument,
  type CanvasNode,
} from '@mini-canvas/canvas-core-v2'
import { autoLayoutPlugin } from '../autoLayoutPlugin'

/** 最小 nodeLayout stub（render 层服务的只读子集：绝对矩形 + 实测尺寸） */
function makeLayout(nodeStore: NodeStore) {
  return {
    getNodeRect(id: string) {
      const n = nodeStore.getNode(id)
      if (!n) return null
      return { id, x: n.position.x, y: n.position.y, w: n.size?.w ?? 200, h: n.size?.h ?? 100 }
    },
    nodeSize(id: string) {
      const n = nodeStore.getNode(id)
      return { w: n?.size?.w ?? 200, h: n?.size?.h ?? 100 }
    },
  }
}

/** 最小 viewport stub（node 测试无 DOM） */
function makeViewport() {
  const state = { x: 0, y: 0, zoom: 1 }
  return {
    getViewport: () => ({ ...state }),
    setViewport: (v: { x: number; y: number; zoom: number }) => Object.assign(state, v),
    fitView: () => undefined,
    getRootEl: () => null,
  }
}

function makeCtx() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 100 } })
  ctx.inject('nodeStore', nodeStore)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => JSON.parse(JSON.stringify(nodeStore.getNodes())) as CanvasNode[],
    restore: (nodes) => nodeStore.replaceAll((nodes as CanvasNode[]) ?? []),
  })
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  const command = new CommandRegistry()
  ctx.inject('command', command)
  ctx.inject('nodeLayout', makeLayout(nodeStore) as never)
  ctx.inject('viewport', makeViewport() as never)
  ctx.plugin(autoLayoutPlugin)
  return { ctx, nodeStore, edgeStore, command }
}

function addNode(ns: NodeStore, x: number, y: number, w = 200, h = 100): string {
  ns.addNodes([{ type: 'text', position: { x, y }, size: { w, h } }])
  return ns.getNodes().at(-1)!.id
}

describe('auto-layout 配置分组（二级分类）', () => {
  it('设置分组按「一级/二级」分层，而不是扁平一级', async () => {
    const { ctx } = makeCtx()
    await ctx.start()
    const groups = ctx.get<{ groups(): string[] }>('settings').groups()
    expect(groups).toContain('布局/自动布局方向')
    expect(groups).toContain('布局/自动布局间距')
    expect(groups).toContain('布局/自动布局聚焦')
    expect(groups).toContain('布局/诊断')
    // 不再有扁平的「布局」一级残留
    expect(groups).not.toContain('布局')
  })
})

describe('auto-layout 配置改动实时生效', () => {
  it('面板改 direction=TB 后执行布局，节点垂直排布（而非仍按 LR）', async () => {
    const { ctx, nodeStore, edgeStore, command } = makeCtx()
    const a = addNode(nodeStore, 0, 0)
    const b = addNode(nodeStore, 400, 400)
    edgeStore.addEdge({ source: a, target: b })
    await ctx.start()

    const settings = ctx.get<{
      get(k: string): string | number | boolean
      set(k: string, v: string | number | boolean): boolean
    }>('settings')

    command.execute('auto-layout:run')
    const lrA = nodeStore.getNode(a)!
    const lrB = nodeStore.getNode(b)!
    // LR：b 在 a 右侧（x 更大）
    expect(lrB.position.x).toBeGreaterThan(lrA.position.x)

    // 改配置 → 再布局
    settings.set('direction', 'TB')
    expect(settings.get('direction')).toBe('TB')
    command.execute('auto-layout:run')

    const tbA = nodeStore.getNode(a)!
    const tbB = nodeStore.getNode(b)!
    // TB：b 应在 a 下方（y 更大），x 接近
    expect(tbB.position.y).toBeGreaterThan(tbA.position.y)
    expect(Math.abs(tbB.position.x - tbA.position.x)).toBeLessThanOrEqual(1)
  })

  it('面板改组内间距后，布局结果跟着疏开', async () => {
    const { ctx, nodeStore, edgeStore, command } = makeCtx()
    const a = addNode(nodeStore, 0, 0)
    const b = addNode(nodeStore, 0, 0)
    edgeStore.addEdge({ source: a, target: b })
    await ctx.start()

    const settings = ctx.get<{
      set(k: string, v: string | number | boolean): boolean
    }>('settings')

    command.execute('auto-layout:run')
    const before = nodeStore.getNode(b)!.position.x - nodeStore.getNode(a)!.position.x

    // LR 方向下 a→b 属不同 rank，沿 X 的距离由「水平间距」intraSpacingX 决定。
    // 拉大它 → 再布局，两节点沿 x 应分得更开（证明改配置真的进了本次布局）。
    settings.set('intraSpacingX', 300)
    command.execute('auto-layout:run')
    const after = nodeStore.getNode(b)!.position.x - nodeStore.getNode(a)!.position.x
    expect(after).toBeGreaterThan(before)
  })
})
