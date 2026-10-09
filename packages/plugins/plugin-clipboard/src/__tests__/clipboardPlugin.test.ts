import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { NodeStore, EdgeStore, Selection, History, type CanvasEdge, GraphDocument, createDocService } from '@mini-canvas/canvas-data'
import { CommandRegistry } from '@mini-canvas/kernel'
import { clipboardPlugin, type ClipboardService } from '../clipboardPlugin'

/** 测试本地信封形状（与渲染层宿主 GraphEnvelope 同构；避免插件测试依赖 canvas-render） */
interface GraphEnvelope {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>
  edges: CanvasEdge[]
}

/** 组装一个带真实内核服务 + clipboard 插件的最小 ctx（对齐宿主注入，不含渲染层服务） */
function makeCtx() {
  const ctx = new Context()
  const nodeStore = new NodeStore()
  nodeStore.registerType({ type: 'text', label: '文本', defaultSize: { w: 200, h: 100 } })
  const edgeStore = new EdgeStore()
  const selection = new Selection()
  ctx.inject('selection', selection)
  const history = new History({
    snapshot: () => ({
      nodes: JSON.parse(JSON.stringify(nodeStore.getNodes())) as GraphEnvelope['nodes'],
      edges: JSON.parse(JSON.stringify(edgeStore.getEdges())) as GraphEnvelope['edges'],
    }),
    restore: (g) => {
      const env = (g as GraphEnvelope) ?? { nodes: [], edges: [] }
      nodeStore.replaceAll(env.nodes ?? [])
      edgeStore.replaceAll(env.edges ?? [])
    },
  })
  // 5c：数据那一格只有 doc 一个名字（四个老服务名已下线）
  ctx.inject('doc', createDocService({ nodeStore, edgeStore, graph: new GraphDocument(nodeStore, edgeStore, selection, history), history }))
 const command = new CommandRegistry()
  ctx.inject('command', command)
  ctx.plugin(clipboardPlugin)
  return { ctx, nodeStore, edgeStore, selection, history, command }
}

function addNode(ns: NodeStore, type: string, x: number, y: number, data?: Record<string, unknown>) {
  const id = ns.addNodes([{ type, position: { x, y }, data: data ?? { label: 'n' } }])
  return ns.getNodes().at(-1)!.id
}

describe('clipboard 插件集成（真实内核服务）', () => {
  it('copy 无选中返回 false', async () => {
    const { ctx } = makeCtx()
    await ctx.start()
    expect(ctx.get<ClipboardService>('clipboard').copy()).toBe(false)
  })

  it('copy → paste：节点克隆 + 内连边重连 + 新节点保持选中 + 原子历史', async () => {
    const { ctx, nodeStore, edgeStore, selection, history } = makeCtx()
    const a = addNode(nodeStore, 'text', 0, 0)
    const b = addNode(nodeStore, 'text', 300, 0)
    const c = addNode(nodeStore, 'text', 600, 0)
    const edgeInside = edgeStore.addEdge({ source: a, target: b })
    edgeStore.addEdge({ source: b, target: c }) // b→c 两端都在选中，应复制
    edgeStore.addEdge({ source: a, target: c }) // 也是内连边
    selection.set([a, b])

    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    expect(svc.copy()).toBe(true)
    const before = nodeStore.getNodes().length
    const edgesBefore = edgeStore.getEdges().length
    expect(svc.paste()).toBe(true)

    // 节点数量 +2（a,b 克隆）；c 不动
    expect(nodeStore.getNodes().length).toBe(before + 2)
    const newNodes = nodeStore.getNodes().filter((n) => n.id !== a && n.id !== b && n.id !== c)
    expect(newNodes.length).toBe(2)
    // 新节点位置 = 原位置 + 级联偏移 50（无鼠标锚点测试环境）
    const [na, nb] = newNodes
    expect(na.position).toEqual({ x: 0 + 50, y: 0 + 50 })
    expect(nb.position).toEqual({ x: 300 + 50, y: 50 })
    // 内连边 a-b 跟随重连到新节点对；与 c 相连的边不复制
    expect(edgeStore.getEdges().length).toBe(edgesBefore + 1)
    const newEdge = edgeStore.getEdges().find((e) => e.id !== edgeInside && (e.source === na.id || e.source === nb.id))
    expect(newEdge).toBeTruthy()
    expect(newEdge!.source === na.id && newEdge!.target === nb.id).toBe(true)
    // 选中切到新粘贴节点
    expect(selection.ids.has(na.id)).toBe(true)
    expect(selection.ids.has(nb.id)).toBe(true)
    expect(selection.ids.size).toBe(2)
    // 历史一次可撤销
    expect(history.canUndo()).toBe(true)
    history.undo()
    expect(nodeStore.getNodes().length).toBe(before)
    expect(edgeStore.getEdges().length).toBe(edgesBefore)
  })

  it('cut：复制到剪贴板 + 删除节点与触碰边，可撤销恢复', async () => {
    const { ctx, nodeStore, edgeStore, selection, history } = makeCtx()
    const a = addNode(nodeStore, 'text', 0, 0)
    const b = addNode(nodeStore, 'text', 300, 0)
    const c = addNode(nodeStore, 'text', 600, 0)
    edgeStore.addEdge({ source: a, target: b })
    edgeStore.addEdge({ source: b, target: c })
    selection.set([a, b])

    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    expect(svc.cut()).toBe(true)
    // a,b 及其相连边都删了；c 保留
    expect(nodeStore.getNode(a)).toBeUndefined()
    expect(nodeStore.getNode(b)).toBeUndefined()
    expect(nodeStore.getNode(c)).toBeDefined()
    expect(edgeStore.getEdges().length).toBe(0)
    // 剪贴板还有数据可粘贴（cut = 移动语义）
    expect(svc.hasData).toBe(true)
    // 撤销恢复节点与边
    expect(history.canUndo()).toBe(true)
    history.undo()
    expect(nodeStore.getNode(a)).toBeDefined()
    expect(nodeStore.getNode(b)).toBeDefined()
    expect(edgeStore.getEdges().length).toBe(2)
  })

  it('duplicate = copy + paste；hasData 语义', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 10, 20)
    selection.set([a])
    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    // 说明：共享剪贴板为模块级静态（与老版全局 clipboard 一致），前序测试可能已留数据，
    // 故不断言初始为 false；这里验证 duplicate 用"当前选中"复制（覆盖旧剪贴板）+ hasData 恒真。
    expect(svc.duplicate()).toBe(true)
    expect(svc.hasData).toBe(true)
    expect(nodeStore.getNodes().length).toBe(2)
    const clone = nodeStore.getNodes().find((n) => n.id !== a)!
    expect(clone.data).toEqual(nodeStore.getNode(a)!.data)
  })

  it('粘贴后可再次 paste 级联偏移递增', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 0, 0)
    selection.set([a])
    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    svc.copy()
    expect(svc.paste()).toBe(true)
    expect(svc.paste()).toBe(true)
    // 原节点 + 两次粘贴 = 3；第二次粘贴偏移 70（50+20）
    const nodes = nodeStore.getNodes()
    expect(nodes.length).toBe(3)
    const pasted = nodes.filter((n) => n.id !== a).sort((p, q) => p.position.x - q.position.x)
    expect(pasted[0].position).toEqual({ x: 50, y: 50 })
    expect(pasted[1].position).toEqual({ x: 70, y: 70 })
  })

  it('复制后清空选中再粘贴仍有效（剪贴板独立于当前选中）', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 0, 0)
    selection.set([a])
    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    svc.copy()
    selection.clear()
    expect(svc.paste()).toBe(true)
    expect(nodeStore.getNodes().length).toBe(2)
  })

  it('复制节点 data 深拷贝：改粘贴 data 不影响原节点', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    const a = addNode(nodeStore, 'text', 0, 0, { label: 'orig', nested: { v: 1 } })
    selection.set([a])
    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    svc.copy()
    svc.paste()
    const pasted = nodeStore.getNodes().find((n) => n.id !== a)!
    ;(pasted.data.nested as { v: number }).v = 999
    expect((nodeStore.getNode(a)!.data.nested as { v: number }).v).toBe(1)
  })
})

describe('clipboard 实例隔离（P2-4）', () => {
  it('两个画布实例剪贴板互不串：A copy 后 B.hasData 仍为 false', async () => {
    const a = makeCtx()
    const b = makeCtx()
    await a.ctx.start()
    await b.ctx.start()
    const id = addNode(a.nodeStore, 'text', 0, 0)
    a.selection.set([id])
    const svcA = a.ctx.get<ClipboardService>('clipboard')
    const svcB = b.ctx.get<ClipboardService>('clipboard')
    expect(svcA.copy()).toBe(true)
    // B 实例没有 A 的数据（不再模块级 static 共享）
    expect(svcB.hasData).toBe(false)
    expect(svcB.paste()).toBe(false)
    // A 自己仍可粘贴
    expect(svcA.hasData).toBe(true)
    const before = a.nodeStore.getNodes().length
    expect(svcA.paste()).toBe(true)
    expect(a.nodeStore.getNodes().length).toBe(before + 1)
  })
})

/**
 * 用户 2026-10-09 报的缺陷端到端复现：复制一个带子节点的分组（框选整块：父 + 子），
 * 粘贴后子节点位置必须仍然相对父、父子关系必须还在。
 *
 * 子节点 position 是**相对父的局部坐标**（v2 内核 + VueFlow 父子语义），
 * 复制的偏移只能作用在父（绝对坐标）上，子的相对坐标必须原样保留。
 */
describe('复制带子节点的分组（父子坐标系，用户 2026-10-09 缺陷）', () => {
  /** 注入一个最小 nodeLayout：absolutePosition 沿 parentId 链累加（与渲染层实现同语义） */
  function injectLayout(ctx: { inject: (n: string, s: unknown) => void }, nodeStore: NodeStore) {
    const abs = (id: string) => {
      let n = nodeStore.getNode(id)
      let x = n?.position.x ?? 0
      let y = n?.position.y ?? 0
      const seen = new Set<string>([id])
      while (n?.parentId) {
        if (seen.has(n.parentId)) break
        seen.add(n.parentId)
        const p = nodeStore.getNode(n.parentId)
        if (!p) break
        x += p.position.x
        y += p.position.y
        n = p
      }
      return { x, y }
    }
    ctx.inject('nodeLayout', {
      nodeSize: (id: string) => nodeStore.getNode(id)?.size ?? { w: 0, h: 0 },
      absolutePosition: abs,
      getNodeRect: (id: string) => {
        const node = nodeStore.getNode(id)
        if (!node) return null
        const { x, y } = abs(id)
        const size = node.size ?? { w: 0, h: 0 }
        return { id, x, y, w: size.w, h: size.h }
      },
      getAllRects: () => nodeStore.getNodes().map((n) => ({ id: n.id, ...abs(n.id), w: n.size?.w ?? 0, h: n.size?.h ?? 0 })),
      childrenOf: (pid: string) => nodeStore.childNodesOf(pid).map((n) => ({ id: n.id, ...abs(n.id), w: n.size?.w ?? 0, h: n.size?.h ?? 0 })),
    })
  }

  it('父+子一起复制：粘贴后父整体平移，子相对坐标不变、parentId 指向新父', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    injectLayout(ctx, nodeStore)
    // 分组在绝对 (1000,1000)，尺寸 400x300
    const g = addNode(nodeStore, 'text', 1000, 1000, { label: 'G' })
    nodeStore.updateNode(g, { size: { w: 400, h: 300 } })
    // 子节点：相对分组的局部坐标 (30,40)
    const c = addNode(nodeStore, 'text', 30, 40, { label: 'C' })
    nodeStore.updateNode(c, { parentId: g })
    selection.set([g, c])

    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    expect(svc.copy()).toBe(true)
    expect(svc.paste()).toBe(true)

    const pasted = nodeStore.getNodes().filter((n) => n.id !== g && n.id !== c)
    expect(pasted.length).toBe(2)
    const ng = pasted.find((n) => n.parentId === undefined)!
    const nc = pasted.find((n) => n.parentId !== undefined)!
    // 新父 = 原父 + 级联偏移 50（无鼠标锚点）
    expect(ng.position).toEqual({ x: 1050, y: 1050 })
    // 子仍在父内部：相对坐标一格没动 —— 这是"父子关系没丢、子没四散"的判据
    expect(nc.position).toEqual({ x: 30, y: 40 })
    expect(nc.parentId).toBe(ng.id)
    // 子绝对坐标 = 新父 + 相对 = (1080,1090)，与旧的 (1030,1040) 相差整块偏移 (50,50)
    expect(nc.position.x + ng.position.x).toBe(1080)
    expect(nc.position.y + ng.position.y).toBe(1090)
  })

  it('只复制子节点（父未被选中）：按绝对坐标落顶层，不悬挂', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    injectLayout(ctx, nodeStore)
    const g = addNode(nodeStore, 'text', 1000, 1000, { label: 'G' })
    const c = addNode(nodeStore, 'text', 30, 40, { label: 'C' })
    nodeStore.updateNode(c, { parentId: g })
    selection.set([c])

    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    svc.copy()
    svc.paste()
    const clone = nodeStore.getNodes().find((n) => n.id !== g && n.id !== c)!
    // 父在批外 → 剥离父引用，按复制时刻的绝对坐标 (1030,1040) + 偏移 50 落顶层
    expect(clone.parentId).toBeUndefined()
    expect(clone.position).toEqual({ x: 1080, y: 1090 })
  })
})
