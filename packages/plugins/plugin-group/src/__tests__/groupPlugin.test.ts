import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, Selection, History, type CanvasNode, EdgeStore, GraphDocument } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { groupPlugin, GroupService, GROUP_NODE_TYPE, resolveGroupPadding, GROUP_PADDING_KEYS } from '../groupPlugin'
import { DEFAULT_GROUP_PADDING } from '../groupEngine'

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

  it('createGroup：成员<2 / 已分组节点过滤 / 组节点允许嵌套一层', async () => {
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
    // B 方案：组节点允许打组（嵌套一层）→ 新组包住旧组
    const c = addNode(nodeStore, 'text', 500, 0)
    const nested = svc.createGroup([gid, c])
    expect(nested).toBeTruthy()
    expect(nodeStore.getNode(gid)?.parentId).toBe(nested)
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
    svc.applyDragMembership(c)
    expect(nodeStore.getNode(c)?.parentId).toBe(gid)
  })

  it('applyDragMembership：子节点移出组外 → 解父还原绝对坐标', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    // b 在组内：相对坐标改到远离组包围盒（组 70,60 380x230 → 绝对右下 450,290）
    nodeStore.updateNode(b, { position: { x: 2000, y: 2000 } })
    svc.applyDragMembership(b)
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

  it('类型能力：resizable + transparent（容器型节点：可拖尺寸、卡片底透明让连接线透出）', async () => {
    const { ctx, nodeStore } = makeCtx()
    await ctx.start()
    const def = nodeStore.types.get(GROUP_NODE_TYPE)
    expect(def?.resizable).toBe(true)
    expect(def?.transparent).toBe(true)
    // 容器不参与连线：显式空 inputs/outputs → 外壳不渲染浮动端口
    expect(def?.inputs).toEqual([])
    expect(def?.outputs).toEqual([])
  })

  it('组嵌套一层（B 方案）：拖组A到组B上 → 组A挂 parent 到组B + 坐标转相对', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gidA = svc.createGroup([a, b])!
    const c = addNode(nodeStore, 'text', 1200, 100, { w: 100, h: 80 })
    const d = addNode(nodeStore, 'text', 1400, 200, { w: 120, h: 60 })
    const gidB = svc.createGroup([c, d])!
    // 把组A拖到组B的包围盒内（模拟拖拽结束位置）→ 组A join 组B（B depth=0 → A 新深度 1 合法）
    const gbAbs = { x: nodeStore.getNode(gidB)!.position.x, y: nodeStore.getNode(gidB)!.position.y }
    nodeStore.updateNode(gidA, { position: { x: gbAbs.x + 200, y: gbAbs.y + 100 } })
    svc.applyDragMembership(gidA)
    const na = nodeStore.getNode(gidA)!
    expect(na.parentId).toBe(gidB)
    // 坐标已转相对组B
    expect(na.position).toEqual({ x: 200, y: 100 })
  })

  it('组嵌套一层：打组允许组节点（组+节点混合 → 新组包住旧组）', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100)
    const b = addNode(nodeStore, 'text', 300, 200)
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gidA = svc.createGroup([a, b])!
    const c = addNode(nodeStore, 'text', 800, 100)
    // 选中 [组A, c] 打组 → 新组包住旧组（A 变 depth1）
    const nested = svc.createGroup([gidA, c])
    expect(nested).toBeTruthy()
    expect(nodeStore.getNode(gidA)?.parentId).toBe(nested)
  })

  it('组嵌套上限：内层组不能再被包进新组（拖拽与打组两条路径都拒绝）', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100)
    const b = addNode(nodeStore, 'text', 300, 200)
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gidA = svc.createGroup([a, b])!
    const c = addNode(nodeStore, 'text', 800, 100)
    // 第一层嵌套：混合打组 → 外层组C 包住 组A（A 变 depth1）
    const gidC = svc.createGroup([gidA, c])!
    expect(nodeStore.getNode(gidA)?.parentId).toBe(gidC)
    // 再建顶层组B
    const d = addNode(nodeStore, 'text', 1600, 100)
    const d2 = addNode(nodeStore, 'text', 1800, 200)
    const gidB = svc.createGroup([d, d2])!
    // ① 打组路径：选中 [内层组A(depth1), 组B(depth0)] 打组 → A depth>=1 被过滤，只剩 B → null
    expect(svc.createGroup([gidA, gidB])).toBeNull()
    // ② 拖拽路径：把组B(depth0) 拖进 内层组A(depth1) → 新深度 2 > 上限 → 拒绝
    const absA = svc.getGroupBounds(gidA)!
    nodeStore.updateNode(gidB, { position: { x: absA.x + 20, y: absA.y + 20 } })
    svc.applyDragMembership(gidB)
    expect(nodeStore.getNode(gidB)?.parentId).toBeUndefined()
  })
  })

  describe('嵌套跨层移动的坐标换算（用户实测 bug）', () => {
    /** 场景：外层组B(depth0) ⊃ 内层组A(depth1) ⊃ 节点x；另有组C(depth0)、顶层空白。 */
    async function makeNested(): Promise<{
      ctx: ReturnType<typeof makeCtx>['ctx']
      nodeStore: ReturnType<typeof makeCtx>['nodeStore']
      svc: GroupService
      gB: string
      gA: string
      gC: string
      x: string
    }> {
      const { ctx, nodeStore } = makeCtx()
      const a1 = addNode(nodeStore, 'text', 30, 40, { w: 100, h: 80 })
      const a2 = addNode(nodeStore, 'image', 400, 100, { w: 200, h: 150 })
      await ctx.start()
      const svc = ctx.get<GroupService>('group')
      const gB = svc.createGroup([a1, a2])!
      const b1 = addNode(nodeStore, 'text', 1300, 300, { w: 100, h: 80 })
      const b2 = addNode(nodeStore, 'image', 1500, 400, { w: 200, h: 150 })
      const gA = svc.createGroup([b1, b2])!
      // 组A 建在绝对 (1300,300) 附近 —— 把它挪进组B 范围内并嵌套
      nodeStore.updateNode(gA, { position: { x: 100, y: 50 } })
      svc.applyDragMembership(gA)
      expect(nodeStore.getNode(gA)?.parentId).toBe(gB)
      // 节点 x 挪进组A 范围 → join 组A（此时组A depth1）
      const x = addNode(nodeStore, 'text', 500, 500, { w: 60, h: 60 })
      nodeStore.updateNode(x, { position: { x: 150, y: 120 } })
      svc.applyDragMembership(x)
      expect(nodeStore.getNode(x)?.parentId).toBe(gA)
      const c1 = addNode(nodeStore, 'text', 1800, 100, { w: 100, h: 80 })
      const c2 = addNode(nodeStore, 'image', 2100, 200, { w: 200, h: 150 })
      const gC = svc.createGroup([c1, c2])!
      return { ctx, nodeStore, svc, gB, gA, gC, x }
    }

    it('第二层组内节点拖到外层组（组B）内 → join 后相对坐标正确', async () => {
      const { nodeStore, svc, gB, x } = await makeNested()
      const absB = svc.getGroupBounds(gB)!
      // x 拖到组B 内 (绝对 200,200)
      nodeStore.updateNode(x, { position: { x: 200 - nodeStore.getNode(gB)!.position.x - 100, y: 200 - nodeStore.getNode(gB)!.position.y - 40 } })
      // ↑ 上一行把 x 的 store 坐标改到"绝对≈(200,200)"对应位置（x 此时的父是内层组A）
      svc.applyDragMembership(x)
      const nx = nodeStore.getNode(x)!
      expect(nx.parentId).toBe(gB)
      // 相对组B = 绝对(200,200) - 组B frame 左上
      expect(nx.position).toEqual({ x: 200 - absB.x, y: 200 - absB.y })
    })

    it('第二层组内节点拖到最外层空白 → 解父后绝对坐标正确（不再少加一层）', async () => {
      const { ctx, nodeStore, svc, x } = await makeNested()
      // x 当前的绝对坐标（挂在内层组A 下，父链两层）
      const layoutSvc = ctx.get('nodeLayout')
      const realAbs = layoutSvc.absolutePosition(x)
      // 把 x 拖出内层组A 范围（远离）→ leave → 位置必须等于 realAbs
      const delta = { x: 3000, y: 3000 }
      nodeStore.updateNode(x, { position: { x: nodeStore.getNode(x)!.position.x + delta.x, y: nodeStore.getNode(x)!.position.y + delta.y } })
      svc.applyDragMembership(x)
      const nx = nodeStore.getNode(x)!
      expect(nx.parentId).toBeUndefined()
      expect(nx.position).toEqual({ x: realAbs.x + delta.x, y: realAbs.y + delta.y })
    })
  })

describe('resolveGroupPadding padding 配置解析（纯函数）', () => {
  it('全部读不到 → 默认值', () => {
    expect(resolveGroupPadding(() => undefined)).toEqual(DEFAULT_GROUP_PADDING)
  })
  it('读到合法值 → 逐项生效', () => {
    const values: Record<string, number> = {
      [GROUP_PADDING_KEYS.left]: 10,
      [GROUP_PADDING_KEYS.right]: 20,
      [GROUP_PADDING_KEYS.top]: 5,
      [GROUP_PADDING_KEYS.bottom]: 15,
    }
    expect(resolveGroupPadding((k) => values[k])).toEqual({ left: 10, right: 20, top: 5, bottom: 15 })
  })
  it('非法值（负数/非数值/NaN）逐项回落默认，0 是合法值', () => {
    const values: Record<string, unknown> = {
      [GROUP_PADDING_KEYS.left]: -5,
      [GROUP_PADDING_KEYS.right]: 'x',
      [GROUP_PADDING_KEYS.top]: NaN,
      [GROUP_PADDING_KEYS.bottom]: 0,
    }
    expect(resolveGroupPadding((k) => values[k])).toEqual({ left: 30, right: 30, top: 40, bottom: 0 })
  })
})

describe('分组 padding 配置（settings 单一数据源）', () => {
  it('settings 改 padding → createGroup 实时按新值算包围盒 + 子节点相对坐标跟随', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    selection.set([a, b])
    await ctx.start()
    // Config schema 默认声明过这些 key（插件激活时登记），直接改值
    ctx.settings.set(GROUP_PADDING_KEYS.left, 10)
    ctx.settings.set(GROUP_PADDING_KEYS.right, 20)
    ctx.settings.set(GROUP_PADDING_KEYS.top, 5)
    ctx.settings.set(GROUP_PADDING_KEYS.bottom, 15)
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    const group = nodeStore.getNode(gid)!
    // 内容包围盒 (100,100)-(420,260)：left10/top5 → 左上 (90,95)；宽 320+10+20=350；高 160+5+15=180
    expect(group.position).toEqual({ x: 90, y: 95 })
    expect(group.size).toEqual({ w: 350, h: 180 })
    // 子节点相对坐标 = 绝对 - 新组左上
    expect(nodeStore.getNode(a)!.position).toEqual({ x: 10, y: 5 })
    expect(nodeStore.getNode(b)!.position).toEqual({ x: 210, y: 105 })
  })

  it('拖拽归组与建组共用同一套 membership 决策（applyDragMembership）', async () => {
    const { ctx, nodeStore } = makeCtx()
    const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
    const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
    await ctx.start()
    const svc = ctx.get<GroupService>('group')
    const gid = svc.createGroup([a, b])!
    // 顶层节点落进组内
    const c = addNode(nodeStore, 'text', 120, 120, { w: 50, h: 50 })
    svc.applyDragMembership(c)
    expect(nodeStore.getNode(c)?.parentId).toBe(gid)
    // 组内节点拖出组外 → 解父还原绝对坐标
    nodeStore.updateNode(c, { position: { x: 2000, y: 2000 } })
    svc.applyDragMembership(c)
    const nc = nodeStore.getNode(c)!
    expect(nc.parentId).toBeUndefined()
    const g = nodeStore.getNode(gid)!
    expect(nc.position).toEqual({ x: g.position.x + 2000, y: g.position.y + 2000 })
  })
})
