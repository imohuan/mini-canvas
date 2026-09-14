/**
 * 3D 预览节点快捷键 —— 与内核命令分发的整链契约。
 *
 * 用户要求（原话）："给他一些节点操作快捷键…r 重置，f 全屏（切换效果-注意这里画布也可能注册了 f，
 * 你需要有一个优先级，选中节点之后支持这些快捷键）"。
 *
 * 这条测试专门盯**优先级**：真实内核 + 本插件 + 一个"模拟自动布局"的竞争命令（同样绑 f/r），
 * 断言选中 3D 节点时 f/r 归节点、没选中时让位回画布命令。
 * 只测纯函数（resolveCommandTarget）看不出"when 有没有真的接上分发"，所以这里走真分发。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry, findCommandByKeys } from '@mini-canvas/kernel'
import { NodeFactory, NodeRegistry, ThemeRegistry } from '@mini-canvas/canvas-data'
import { node3dPreviewPlugin, PANORAMA_NODE_TYPE } from '../node3dPreviewPlugin'
import { isFullscreen, resetInteractSessions, resetViewToken } from '../panoramaSession'

/** 模拟自动布局插件：f=聚焦选中、r=适应视图（与真实插件同 order，用来验优先级） */
function registerCanvasRivals(ctx: Context) {
  ctx.commands.register({ id: 'auto-layout:focus-selected', title: '聚焦选中节点', keys: ['f'], order: 20, run: () => 'focus' })
  ctx.commands.register({ id: 'auto-layout:fit-view', title: '适应视图', keys: ['r'], order: 30, run: () => 'fit' })
}

async function boot() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  const history = new History({
    snapshot: () => ({ nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())), edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) }),
    restore: (g: { nodes: unknown[]; edges: unknown[] }) => {
      nodeStore.replaceAll(g.nodes as never)
      edgeStore.replaceAll(g.edges as never)
    },
  })
  ctx.inject('nodeStore', nodeStore)
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('selection', selection)
  ctx.inject('history', history)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
  ctx.inject('command', new CommandRegistry())
  ctx.inject('nodeFactory', new NodeFactory())
  ctx.inject('nodeRegistry', new NodeRegistry())
  ctx.inject('themeRegistry', new ThemeRegistry())

  // 一个"别的类型"节点，用来验"选中的不是 3D 节点就不抢键"
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 }, outputs: [{ port: 'source', contentType: 'image' }] })

  ctx.plugin(node3dPreviewPlugin)
  registerCanvasRivals(ctx)
  await ctx.start()
  const command = ctx.get<CommandLike>('command')
  return { ctx, nodeStore, selection, command }
}

/** 命令注册表的最小形状（本测试用到的两个方法） */
type CommandLike = {
  list(): Array<{ id: string; keys?: string[]; order?: number; when?: (c: unknown) => boolean }>
  execute(id: string): unknown
}

/** 走真实分发：把当前命中该键的命令算出来并执行（等价 CanvasHost 的 keydown 处理） */
function pressKey(ctx: Context, command: CommandLike, key: string): unknown {
  const hit = findCommandByKeys(command.list(), { key }, ctx)
  if (!hit) return undefined
  return command.execute(hit.id)
}

describe('f 全屏 / r 重置：选中 3D 节点时才归节点', () => {
  it('选中 3D 节点 → f 命中的是节点的全屏命令（不是画布的聚焦）', async () => {
    resetInteractSessions()
    const { ctx, selection, command } = await boot()
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }): string }>('panorama3d')
    const id = svc.addPreviewNode({ x: 0, y: 0 })
    selection.set([id])

    const hit = findCommandByKeys(command.list(), { key: 'f' }, ctx)
    expect(hit?.id).toBe('3d-preview:fullscreen')
    ctx.stop()
  })

  it('没选中 → f 让位给画布的聚焦命令（节点命令不会把全局快捷键吃掉）', async () => {
    resetInteractSessions()
    const { ctx, selection, command } = await boot()
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }): string }>('panorama3d')
    svc.addPreviewNode({ x: 0, y: 0 })
    selection.clear()

    expect(findCommandByKeys(command.list(), { key: 'f' }, ctx)?.id).toBe('auto-layout:focus-selected')
    expect(findCommandByKeys(command.list(), { key: 'r' }, ctx)?.id).toBe('auto-layout:fit-view')
    ctx.stop()
  })

  it('选中的是别的类型 → 一样让位（不抢画布的 f/r）', async () => {
    resetInteractSessions()
    const { ctx, nodeStore, selection, command } = await boot()
    const imgId = nodeStore.addNode('image', { x: 0, y: 0 })
    selection.set([imgId])

    expect(findCommandByKeys(command.list(), { key: 'f' }, ctx)?.id).toBe('auto-layout:focus-selected')
    expect(findCommandByKeys(command.list(), { key: 'r' }, ctx)?.id).toBe('auto-layout:fit-view')
    ctx.stop()
  })

  it('多选（其中含 3D 节点）→ 让位：该操作哪一个不明确就不猜', async () => {
    resetInteractSessions()
    const { ctx, nodeStore, selection, command } = await boot()
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }): string }>('panorama3d')
    const panoId = svc.addPreviewNode({ x: 0, y: 0 })
    const imgId = nodeStore.addNode('image', { x: 0, y: 0 })
    selection.set([panoId, imgId])

    expect(findCommandByKeys(command.list(), { key: 'f' }, ctx)?.id).toBe('auto-layout:focus-selected')
    ctx.stop()
  })
})

describe('命令真的干活（不只是命中）', () => {
  it('按 f：进入全屏，再按 f 退出（切换语义）', async () => {
    resetInteractSessions()
    const { ctx, selection, command } = await boot()
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }): string }>('panorama3d')
    const id = svc.addPreviewNode({ x: 0, y: 0 })
    selection.set([id])

    expect(pressKey(ctx, command, 'f')).toBe(true)
    expect(isFullscreen(id)).toBe(true)
    expect(pressKey(ctx, command, 'f')).toBe(false)
    expect(isFullscreen(id)).toBe(false)
    ctx.stop()
  })

  it('按 r：向组件发出"重置视角"信号（token +1；连按两次各算一次）', async () => {
    resetInteractSessions()
    const { ctx, selection, command } = await boot()
    const svc = ctx.get<{ addPreviewNode(p: { x: number; y: number }): string }>('panorama3d')
    const id = svc.addPreviewNode({ x: 0, y: 0 })
    selection.set([id])

    expect(resetViewToken(id)).toBe(0)
    pressKey(ctx, command, 'r')
    expect(resetViewToken(id)).toBe(1)
    pressKey(ctx, command, 'r')
    expect(resetViewToken(id)).toBe(2)
    ctx.stop()
  })

  it('两个命令都进快捷键帮助列表（用户能查到有这些键）', async () => {
    resetInteractSessions()
    const { ctx, command } = await boot()
    const withKeys = command.list().filter((c) => c.keys && c.keys.length > 0).map((c) => c.id)
    expect(withKeys).toContain('3d-preview:fullscreen')
    expect(withKeys).toContain('3d-preview:reset')
    ctx.stop()
  })
})

describe('节点类型没被改坏', () => {
  it('3d-preview 类型仍正常注册（本次只加快捷键，未动类型声明）', async () => {
    resetInteractSessions()
    const { ctx, nodeStore } = await boot()
    expect(nodeStore.types.has(PANORAMA_NODE_TYPE)).toBe(true)
    ctx.stop()
  })
})
