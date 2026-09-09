import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-core-v2'
import {
  NodeStore,
  Selection,
  History,
 CommandRegistry,
 type CanvasNode,
  EdgeStore,
  GraphDocument,
} from '@mini-canvas/canvas-core-v2'
import { groupPlugin, GroupService, GROUP_NODE_TYPE } from '../groupPlugin'

/** 最小 nodeLayout stub（对齐渲染层 NodeLayoutService 接口中本插件用到的三个方法） */
interface LayoutStub {
  getAllRects(): Array<{ id: string; x: number; y: number; w: number; h: number }>
  getNodeRect(id: string): { id: string; x: number; y: number; w: number; h: number } | null
}

function makeCtx() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 100 } })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 240, h: 160 } })
  ctx.inject('nodeStore', nodeStore)
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => JSON.parse(JSON.stringify(nodeStore.getNodes())) as CanvasNode[],
    restore: (nodes) => nodeStore.replaceAll((nodes as CanvasNode[]) ?? []),
  })
 ctx.inject('history', history)
  const edgeStore = new EdgeStore()
  ctx.inject('edgeStore', edgeStore)
  ctx.inject('graph', new GraphDocument(nodeStore, edgeStore, selection, history))
 const command = new CommandRegistry()
  ctx.inject('command', command)

  // nodeLayout stub：按 nodeStore 计算绝对矩形（子节点累加父链）
  const layout: LayoutStub = {
    getNodeRect(id) {
      const n = nodeStore.getNode(id)
      if (!n) return null
      let x = n.position.x
      let y = n.position.y
      let p = n.parentId ? nodeStore.getNode(n.parentId) : undefined
      let guard = 0
      while (p && guard < 20) {
        x += p.position.x
        y += p.position.y
        p = p.parentId ? nodeStore.getNode(p.parentId) : undefined
        guard++
      }
      return { id, x, y, w: n.size?.w ?? 200, h: n.size?.h ?? 100 }
    },
    getAllRects() {
      return nodeStore.getNodes().map((n) => this.getNodeRect(n.id)!).filter(Boolean)
    },
  }
  ctx.inject('nodeLayout', layout as never)

  ctx.plugin(groupPlugin)
  return { ctx, nodeStore, selection, history, command, layout }
}

/** 添加一个带声明尺寸的顶层节点，返回 id */
function addNode(ns: NodeStore, type: string, x: number, y: number, size?: { w: number; h: number }): string {
  ns.addNodes([{ type, position: { x, y }, size }])
  return ns.getNodes().at(-1)!.id
}

describe('group 插件集成（真实内核服务）', () => {
  it('createGroup：两个顶层节点 → 建组 + 子节点转相对坐标 + 挂父', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    selection.set([a, b])
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])
    expect(gid).toBeTruthy()
    const group = nodeStore.getNode(gid!)
    expect(group?.type).toBe(GROUP_NODE_TYPE)
    // 包围盒：padding 30/顶 10（见引擎测试同款输入）
    expect(group?.position).toEqual({ x: 70, y: 60 })
    expect(group?.size).toEqual({ w: 380, h: 230 })
    // 子节点转相对 + 挂父
    const na = nodeStore.getNode(a)!
    const nb = nodeStore.getNode(b)!
    expect(na.parentId).toBe(gid)
    expect(na.position).toEqual({ x: 30, y: 40 })
    expect(nb.parentId).toBe(gid)
    expect(nb.position).toEqual({ x: 230, y: 140 })
    // 打组后选中组
    expect([...selection.ids]).toEqual([gid])
  })

  it('createGroup：成员<2 / 含组节点 / 已分组节点 → null 或过滤', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 0, 0)
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    selection.set([a])
    expect(svc.createGroup([a])).toBeNull()
    // 已分组节点会被过滤
    const b = addNode(nodeStore, 'text', 200, 0)
    const gid = svc.createGroup([a, b])!
    expect(gid).toBeTruthy()
    // 含组节点再次打组 → 该组被过滤，只剩不到 2 个 → null
    const c = addNode(nodeStore, 'text', 500, 0)
    expect(svc.createGroup([gid, c])).toBeNull()
  })

  it('ungroup：子节点还原绝对坐标 + 删除组节点', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    svc.ungroup(gid)
    expect(nodeStore.getNode(gid)).toBeUndefined()
    expect(nodeStore.getNode(a)?.parentId).toBeUndefined()
    expect(nodeStore.getNode(a)?.position).toEqual({ x: 100, y: 100 })
    expect(nodeStore.getNode(b)?.position).toEqual({ x: 300, y: 200 })
  })

  it('recalculateBounds：组随子节点新绝对位置扩展/收缩', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    const oldSize = nodeStore.getNode(gid)!.size!
    // 移动子节点到更远位置（相对坐标，因为它在组内）
    nodeStore.updateNode(b, { position: { x: 600, y: 400 } })
    const bounds = svc.recalculateBounds(gid)
    expect(bounds).toBeTruthy()
    const group = nodeStore.getNode(gid)!
    // b 被挪远 → 新包围盒比原更大；组左上保持原值（a 仍是左上锚点）
    expect(bounds!.w).toBeGreaterThan(oldSize.w)
    expect(group.position.x).toBe(70)
    expect(group.size!.w).toBe(bounds!.w)
    const nb = nodeStore.getNode(b)!
    // 相对坐标 = 绝对 - 新组左上；绝对 = 原组左上(70) + 600
    expect(nb.position.x).toBe(600)
    expect(nb.position.y).toBe(400)
  })

  it('reparentIfInside：顶层节点拖进组 → 加入', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    const c = addNode(nodeStore, 'text', 100, 100, { w: 50, h: 50 }) // 落在组内
    svc.reparentIfInside(c)
    expect(nodeStore.getNode(c)?.parentId).toBe(gid)
  })

  it('ungroupIfLeft：子节点移出组外 → 解父还原绝对坐标', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    // b 在组内：相对坐标改到远离组包围盒（组 70,60 380x230 → 绝对右下 450,290）
    nodeStore.updateNode(b, { position: { x: 2000, y: 2000 } })
    svc.ungroupIfLeft(b)
    const nb = nodeStore.getNode(b)!
    expect(nb.parentId).toBeUndefined()
    // 还原绝对坐标 = 组左上 + 相对
    const g = nodeStore.getNode(gid)!
    expect(nb.position).toEqual({ x: g.position.x + 2000, y: g.position.y + 2000 })
  })

  it('命令注册：group:create / group:ungroup', async () => {
    const { ctx, command } = makeCtx()
    await ctx.start()
    expect(command.has('group:create')).toBe(true)
    expect(command.has('group:ungroup')).toBe(true)
  })
})
