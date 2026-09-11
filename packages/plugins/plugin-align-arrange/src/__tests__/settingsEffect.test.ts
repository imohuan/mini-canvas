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
import { alignArrangePlugin } from '../alignArrangePlugin'

/** 最小 nodeLayout stub（本插件只用 nodeSize） */
function makeLayout(nodeStore: NodeStore) {
  return {
    nodeSize(id: string) {
      const n = nodeStore.getNode(id)
      return { w: n?.size?.w ?? 200, h: n?.size?.h ?? 100 }
    },
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
  ctx.plugin(alignArrangePlugin)
  return { ctx, nodeStore, selection, command }
}

function addNode(ns: NodeStore, x: number, y: number, w = 200, h = 100): string {
  ns.addNodes([{ type: 'text', position: { x, y }, size: { w, h } }])
  return ns.getNodes().at(-1)!.id
}

type SettingsLike = {
  get(k: string): string | number | boolean
  set(k: string, v: string | number | boolean): boolean
  groupOf(g: string): Array<{ key: string }>
}

describe('align-arrange 配置分组（二级分类）', () => {
  it('间距项与自动布局同住「布局/自动布局方向」，诊断项在「布局/诊断」', async () => {
    const { ctx } = makeCtx()
    await ctx.start()
    const groups = ctx.get<{ groups(): string[] }>('settings').groups()
    expect(groups).toContain('布局/自动布局方向')
    expect(groups).toContain('布局/诊断')
    // 不再单独占一个「方向键排列」二级页签
    expect(groups).not.toContain('布局/方向键排列')
  })

  it('间距拆成 X / Y 两个独立配置项', async () => {
    const { ctx } = makeCtx()
    await ctx.start()
    const keys = ctx
      .get<SettingsLike>('settings')
      .groupOf('布局/自动布局方向')
      .map((e) => e.key)
    expect(keys).toContain('alignArrangeGapX')
    expect(keys).toContain('alignArrangeGapY')
  })
})

describe('align-arrange 配置改动实时生效', () => {
  it('面板改水平间距后，Ctrl+左右键的推挤间隙跟着变', async () => {
    const { ctx, nodeStore, selection, command } = makeCtx()
    // 两个在 x 上重叠、纵向上也重叠的节点：向右紧凑排列时后者会被推到前者右侧 gap 处
    const a = addNode(nodeStore, 0, 0, 100, 100)
    const b = addNode(nodeStore, 0, 0, 100, 100)
    selection.set([a, b])
    await ctx.start()
    const settings = ctx.get<SettingsLike>('settings')

    command.execute('align-arrange:compact-arrowright')
    const gapDefault = nodeStore.getNode(a)!.position.x - nodeStore.getNode(b)!.position.x - 100

    // 拉大水平间距 → 再排列，两节点应隔得更开
    settings.set('alignArrangeGapX', 80)
    command.execute('align-arrange:compact-arrowright')
    const gapWide = nodeStore.getNode(a)!.position.x - nodeStore.getNode(b)!.position.x - 100
    expect(gapWide).toBeGreaterThan(gapDefault)
    expect(gapWide).toBe(80)
  })

  it('改垂直间距后，Ctrl+上下键的推挤间隙跟着变', async () => {
    const { ctx, nodeStore, selection, command } = makeCtx()
    const a = addNode(nodeStore, 0, 0, 100, 100)
    const b = addNode(nodeStore, 0, 0, 100, 100)
    selection.set([a, b])
    await ctx.start()
    const settings = ctx.get<SettingsLike>('settings')

    command.execute('align-arrange:compact-arrowdown')
    // 用两节点竖直间距的绝对值：ArrowDown 是"最下方的保持、其余往上收"，差值符号不稳定
    const gapDefault =
      Math.abs(nodeStore.getNode(b)!.position.y - nodeStore.getNode(a)!.position.y) - 100

    settings.set('alignArrangeGapY', 70)
    command.execute('align-arrange:compact-arrowdown')
    const gapWide = Math.abs(nodeStore.getNode(b)!.position.y - nodeStore.getNode(a)!.position.y) - 100
    expect(gapWide).toBeGreaterThan(gapDefault)
    expect(gapWide).toBe(70)
  })

  it('X 与 Y 互不串：只改垂直间距，左右排列的间隙不变', async () => {
    const { ctx, nodeStore, selection, command } = makeCtx()
    const a = addNode(nodeStore, 0, 0, 100, 100)
    const b = addNode(nodeStore, 0, 0, 100, 100)
    selection.set([a, b])
    await ctx.start()
    const settings = ctx.get<SettingsLike>('settings')

    command.execute('align-arrange:compact-arrowright')
    const before = nodeStore.getNode(a)!.position.x - nodeStore.getNode(b)!.position.x - 100

    settings.set('alignArrangeGapY', 90)
    command.execute('align-arrange:compact-arrowright')
    const after = nodeStore.getNode(a)!.position.x - nodeStore.getNode(b)!.position.x - 100
    expect(after).toBe(before)
  })
})
