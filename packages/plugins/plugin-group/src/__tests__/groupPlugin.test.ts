import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, Selection, History, type CanvasNode, EdgeStore, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { groupPlugin, GroupService, GROUP_NODE_TYPE, resolveGroupPadding, GROUP_PADDING_KEYS } from '../groupPlugin'
import { DEFAULT_GROUP_PADDING } from '../groupEngine'

/** 最小 nodeLayout stub（对齐渲染层 NodeLayoutService 接口中本插件用到的三个方法） */
interface LayoutStub {
  getAllRects(): Array<{ id: string; x: number; y: number; w: number; h: number }>
  getNodeRect(id: string): { id: string; x: number; y: number; w: number; h: number } | null
  absolutePosition(id: string): { x: number; y: number }
}

function makeCtx() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 100 } })
  nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 240, h: 160 } })
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => JSON.parse(JSON.stringify(nodeStore.getNodes())) as CanvasNode[],
    restore: (nodes) => nodeStore.replaceAll((nodes as CanvasNode[]) ?? []),
  })
  const edgeStore = new EdgeStore()
  // 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
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
    absolutePosition(id) {
      const r = this.getNodeRect(id)
      return r ? { x: r.x, y: r.y } : { x: 0, y: 0 }
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

  /**
   * 用户报的三个真 bug 的回归守卫（2026-10-08）：
   *   ① 已在分组内的节点 Ctrl+G 打组曾经静默失效（命令层把有父的节点全滤掉了）；
   *   ② 组内打组曾经坐标算错（子节点相对坐标拿 node.position 算，少减一个原组位置）；
   *   ③ 分组默认名曾经被空串顶掉，标题回落到类型名 → 看起来「分组标题重复」。
   */
  describe('组内打组（Ctrl+G 在分组里也要生效）', () => {
    it('同组内两个节点打组 → 新组挂在原组里，子节点相对坐标按绝对位置算', async () => {
      const { ctx, nodeStore, selection } = makeCtx()
      const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
      const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
      await ctx.start()
      const svc = ctx.get<GroupService>('group')
      const outer = svc.createGroup([a, b])!
      // 再放两个节点进外层组（直接建到绝对位置再拖进组，最贴近真机路径）
      const c = addNode(nodeStore, 'text', 200, 160, { w: 100, h: 80 })
      const d = addNode(nodeStore, 'text', 320, 260, { w: 100, h: 80 })
      svc.applyDragMembership(c)
      svc.applyDragMembership(d)
      expect(nodeStore.getNode(c)?.parentId).toBe(outer)
      expect(nodeStore.getNode(d)?.parentId).toBe(outer)
      // 关键调用：两个「已在组里」的节点打组（老实现这里恒返回 null）
      const inner = svc.createGroup([c, d])
      expect(inner).toBeTruthy()
      expect(nodeStore.getNode(inner!)?.parentId).toBe(outer)
      // 新组深度 = 1（合法）；外层组深度不变
      expect(svc.getGroupDepth(inner!)).toBe(1)
      // 子节点相对新组：绝对位置 - 新组绝对左上（不是「相对坐标 - 新组相对坐标」那套错的）
      const innerAbs = svc.getGroupBounds(inner!)!
      const cAbs = { x: innerAbs.x + nodeStore.getNode(c)!.position.x, y: innerAbs.y + nodeStore.getNode(c)!.position.y }
      expect(cAbs.x).toBeCloseTo(200)
      expect(cAbs.y).toBeCloseTo(160)
    })

    it('跨组打组被拒（父不同不能凭空建组），同父的仍可建', async () => {
      const { ctx, nodeStore } = makeCtx()
      const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
      const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
      const p = addNode(nodeStore, 'text', 900, 100, { w: 100, h: 80 })
      const q = addNode(nodeStore, 'text', 1100, 200, { w: 100, h: 80 })
      await ctx.start()
      const svc = ctx.get<GroupService>('group')
      const g1 = svc.createGroup([a, b])!
      const g2 = svc.createGroup([p, q])!
      // 一个在 g1、一个在 g2 → 父不同 → 拒
      expect(svc.createGroup([a, p])).toBeNull()
      const moved = nodeStore.getNode(a)!
      expect(moved.parentId).toBe(g1)
      void g2
    })

    it('内层组不能再被包进新组（上限 1 仍然守得住）', async () => {
      const { ctx, nodeStore } = makeCtx()
      const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
      const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
      await ctx.start()
      const svc = ctx.get<GroupService>('group')
      const outer = svc.createGroup([a, b])!
      const c = addNode(nodeStore, 'text', 200, 160, { w: 100, h: 80 })
      const e = addNode(nodeStore, 'text', 360, 260, { w: 100, h: 80 })
      svc.applyDragMembership(c)
      svc.applyDragMembership(e)
      const inner = svc.createGroup([c, e])!
      expect(svc.getGroupDepth(inner)).toBe(1)
      // 拿内层组 + 一个同层节点再打组 → 内层组要变成深度 2，越限 → 拒
      const f = addNode(nodeStore, 'text', 700, 100, { w: 100, h: 80 })
      nodeStore.updateNode(f, { parentId: outer, position: { x: 460, y: 40 } })
      expect(svc.createGroup([inner, f])).toBeNull()
      expect(nodeStore.getNode(inner)?.parentId).toBe(outer)
    })

    it('新建的分组拿到编号默认名（不再被空串顶掉）', async () => {
      const { ctx, nodeStore } = makeCtx()
      await ctx.start()
      const svc = ctx.get<GroupService>('group')
      const a = addNode(nodeStore, 'text', 0, 0)
      const b = addNode(nodeStore, 'text', 300, 0)
      const g1 = svc.createGroup([a, b])!
      const c = addNode(nodeStore, 'text', 600, 0)
      const d = addNode(nodeStore, 'text', 900, 0)
      const g2 = svc.createGroup([c, d])!
      const n1 = nodeStore.getNode(g1)!.data.label
      const n2 = nodeStore.getNode(g2)!.data.label
      expect(n1).toBe('分组 1')
      expect(n2).toBe('分组 2')
      expect(n1).not.toBe(n2)
    })

    it('存量迁移：label 是空串的老分组被补上编号名，且不与新建撞号', async () => {
      const { ctx, nodeStore } = makeCtx()
      await ctx.start()
      /**
       * 模拟**冷启动时序**（真机就是这条）：插件 apply 先跑（类型已注册、但画布还是空的），
       * 画布 restore 在之后 —— `replaceAll` 触发一次 `replace`，补名逻辑挂在它上面。
       */
      ctx.get('doc').replaceAll([
        { id: 'old1', type: 'group', position: { x: 0, y: 0 }, size: { w: 300, h: 200 }, data: { label: '', nodeType: 'group' } },
        { id: 'old2', type: 'group', position: { x: 500, y: 0 }, size: { w: 300, h: 200 }, data: { label: '', nodeType: 'group' } },
        { id: 'old3', type: 'group', position: { x: 900, y: 0 }, size: { w: 300, h: 200 }, data: { label: '用户改过的名字', nodeType: 'group' } },
      ])
      expect(nodeStore.getNode('old1')!.data.label).toBe('分组 1')
      expect(nodeStore.getNode('old2')!.data.label).toBe('分组 2')
      // 用户自己改过的名字不许动
      expect(nodeStore.getNode('old3')!.data.label).toBe('用户改过的名字')
      // 之后新建的组接着往数（不与补出来的号撞）
      const a = addNode(nodeStore, 'text', 1300, 0)
      const b = addNode(nodeStore, 'text', 1500, 0)
      const svc = ctx.get<GroupService>('group')
      expect(nodeStore.getNode(svc.createGroup([a, b])!)!.data.label).toBe('分组 3')
    })

    it('解散内层组：子节点升为外层组成员（不是被扔到顶层）', async () => {
      const { ctx, nodeStore } = makeCtx()
      const a = addNode(nodeStore, 'text', 100, 100, { w: 100, h: 80 })
      const b = addNode(nodeStore, 'text', 300, 200, { w: 120, h: 60 })
      await ctx.start()
      const svc = ctx.get<GroupService>('group')
      const outer = svc.createGroup([a, b])!
      const c = addNode(nodeStore, 'text', 200, 160, { w: 100, h: 80 })
      const d = addNode(nodeStore, 'text', 340, 240, { w: 100, h: 80 })
      svc.applyDragMembership(c)
      svc.applyDragMembership(d)
      const inner = svc.createGroup([c, d])!
      const innerAbs = svc.getGroupBounds(inner)!
      const before = { x: innerAbs.x + nodeStore.getNode(c)!.position.x, y: innerAbs.y + nodeStore.getNode(c)!.position.y }
      svc.ungroup(inner)
      const nc = nodeStore.getNode(c)!
      // 归属：升到外层组
      expect(nc.parentId).toBe(outer)
      // 绝对位置不变（只是坐标系换了）
      const outerAbs = svc.getGroupBounds(outer)!
      expect(outerAbs.x + nc.position.x).toBeCloseTo(before.x)
      expect(outerAbs.y + nc.position.y).toBeCloseTo(before.y)
    })
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
      layout: ReturnType<typeof makeCtx>['layout']
      gB: string
      gA: string
      gC: string
      x: string
    }> {
      const { ctx, nodeStore, layout } = makeCtx()
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
      return { ctx, nodeStore, svc, layout, gB, gA, gC, x }
    }

    it('第二层组内节点拖到外层组（组B）内 → join 后相对坐标正确', async () => {
      const { nodeStore, svc, layout, gB, x } = await makeNested()
      const absB = svc.getGroupBounds(gB)!
      // x 拖到组B 内、内层组A 外的绝对位置：store 坐标按当前绝对值平移
      const absBefore = layout.absolutePosition(x)
      const target = { x: absB.x + 30, y: absB.y + absB.h - 30 } // 组B 内、组A 外（组A 在组B 上半部）
      const delta = { x: target.x - absBefore.x, y: target.y - absBefore.y }
      nodeStore.updateNode(x, { position: { x: nodeStore.getNode(x)!.position.x + delta.x, y: nodeStore.getNode(x)!.position.y + delta.y } })
      svc.applyDragMembership(x)
      const nx = nodeStore.getNode(x)!
      expect(nx.parentId).toBe(gB)
      // 相对组B = 绝对(200,200) - 组B frame 左上
      expect(nx.position).toEqual({ x: target.x - absB.x, y: target.y - absB.y })
    })

    it('第二层组内节点拖到最外层空白 → 解父后绝对坐标正确（不再少加一层）', async () => {
      const { ctx, nodeStore, svc, layout, x } = await makeNested()
      // x 当前的绝对坐标（挂在内层组A 下，父链两层）
      const realAbs = layout.absolutePosition(x)
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
