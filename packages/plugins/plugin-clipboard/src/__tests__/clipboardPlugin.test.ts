import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import {
  NodeStore,
  EdgeStore,
  Selection,
  History,
  type CanvasEdge,
  GraphDocument,
  createDocService,
  ResourceStore,
  canvasClipboardPayload,
  parseCanvasClipboardText,
  buildClipboardPastePayload,
  dispatchClipboardPaste,
  CLIPBOARD_PASTE_KIND,
  CLIPBOARD_PASTE_KEY,
  type ClipboardEntry,
  type ClipboardPasteHandler,
} from '@mini-canvas/canvas-data'
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

/** 造一个模拟原生 paste 事件（只覆盖载荷归一用到的字段） */
function pasteEvent(opts: { types?: string[]; data?: Record<string, string> }) {
  const data = opts.data ?? {}
  return {
    preventDefault() {},
    clipboardData: {
      types: opts.types ?? [],
      files: [],
      items: Object.entries(data).map(([type, value]) => ({
        kind: 'string',
        type,
        getAsString(cb: (s: string) => void) {
          cb(value)
        },
      })),
      getData(mime: string) {
        return data[mime] ?? ''
      },
    },
  } as unknown as ClipboardEvent
}

/** 装一个资源库（图片/视频按引用重建地址要用它） */
function installResources(ctx: Context) {
  const resources = new ResourceStore()
  // 桩掉「按引用换地址」这一段（真实实现在 IndexedDB 里，单测不碰它）
  resources.resolve = async (ref: string) => 'blob:resolved-' + ref
  ctx.inject('resources', resources)
  return resources
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
    // 克隆节点内容一致，**只有名字是新取的**（用户 2026-10-12：粘贴后不能和原节点同名）
    const { label: _cloneLabel, ...cloneRest } = clone.data
    const { label: _origLabel, ...origRest } = nodeStore.getNode(a)!.data
    expect(cloneRest).toEqual(origRest)
    expect(clone.data.label).not.toBe(nodeStore.getNode(a)!.data.label)
    expect(String(clone.data.label)).toMatch(/^文本 \d+$/)
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

/**
 * 用户 2026-10-12 报的缺陷①：**在一个浏览器页面复制，无法在另一个浏览器页面粘贴**。
 *
 * 根因：节点数据只活在复制那个页面插件实例的内存里（按画布实例隔离），另一个页面根本没有它。
 * 修法：复制时把**完整载荷**（节点 + 边）写进系统剪贴板，粘贴页读它即可 —— 两个页面之间
 * 共同的只有系统剪贴板。
 */
describe('跨页面粘贴（用户 2026-10-12 缺陷①：换个页面粘不了）', () => {
  /** 另一个画布实例：不同的 nodeStore / selection / 插件实例（= 另一个浏览器页面的等价物） */
  function otherPage() {
    const page = makeCtx()
    installResources(page.ctx)
    return page
  }

  /** 读仲裁场里 clipboard 那条粘贴处理器（与宿主派发时拿到的是同一份） */
  function pasteEntry(ctx: Context) {
    const entries = ctx.registryOf(CLIPBOARD_PASTE_KIND).list(CLIPBOARD_PASTE_KEY) as unknown as Array<
      ClipboardEntry<ClipboardPasteHandler>
    >
    return entries[0].value
  }

  it('页面 A 复制 → 页面 B 靠剪贴板载荷贴出节点（B 的内存剪贴板始终是空的）', async () => {
    const a = makeCtx()
    const b = otherPage()
    await a.ctx.start()
    await b.ctx.start()

    // A：选中一个节点并复制（会往系统剪贴板写完整载荷）
    const id = addNode(a.nodeStore, 'text', 100, 100, { label: '文本 1' })
    a.selection.set([id])
    let written = ''
    expect(a.ctx.get<ClipboardService>('clipboard').copy()).toBe(true)
    // 用原生 copy 事件的同步写口取回 A 实际写进剪贴板的文本（生产路径同一条）
    a.ctx.get<ClipboardService>('clipboard').markSystemClipboard((mime, data) => {
      if (mime === 'text/plain') written = data
      return true
    })
    expect(written.startsWith('mini-canvas-nodes:')).toBe(true)
    expect(parseCanvasClipboardText(written)?.nodes).toHaveLength(1)

    // B：内存剪贴板是空的（另一个页面）—— 过去这里会直接让位，什么也贴不出来
    expect(b.ctx.get<ClipboardService>('clipboard').hasData).toBe(false)

    // B：宿主派发原生 paste（剪贴板里是 A 写的载荷）
    const payload = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': written } }))
    expect(pasteEntry(b.ctx)(payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))

    // B 画布上真的多了一个节点，且**名字重新取号**（不叫「文本 1」）
    const nodes = b.nodeStore.getNodes()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('text')
    expect(nodes[0].data.label).toBe('文本 1') // B 自己没建过别的文本节点，号从 1 起
  })

  it('B 页占着「文本 1」时粘过来的是「文本 2」（按类型的号在目标页重新算）', async () => {
    const a = makeCtx()
    const b = otherPage()
    await a.ctx.start()
    await b.ctx.start()
    // A 与 B 各自都有一个自动补名的「文本 1」（两边号各自独立）
    const id = addNode(a.nodeStore, 'text', 100, 100, { label: '文本 1' })
    b.nodeStore.addNodes([{ type: 'text', position: { x: 0, y: 0 } }])
    a.selection.set([id])
    const svcA = a.ctx.get<ClipboardService>('clipboard')
    svcA.copy()
    let written = ''
    svcA.markSystemClipboard((mime, data) => {
      if (mime === 'text/plain') written = data
      return true
    })

    const payload = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': written } }))
    expect(pasteEntry(b.ctx)(payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))

    const labels = b.nodeStore.getNodes().map((n) => n.data.label)
    expect(labels).toEqual(['文本 1', '文本 2'])
  })

  it('另一个页面复制的是图片：按 resourceId 重建本页地址（blob: 地址跨页面是死链）', async () => {
    const a = makeCtx()
    const b = makeCtx()
    for (const page of [a, b]) {
      page.nodeStore.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 }, nameTemplate: '图片 {{ID}}' })
    }
    installResources(b.ctx)
    await a.ctx.start()
    await b.ctx.start()

    // A 上那张图的地址是 A 页面的 blob:（换页即失效），引用 resourceId 是持久的
    const id = addNode(a.nodeStore, 'image', 10, 10, { label: '图片 1', resourceId: 'res-9', imageUrl: 'blob:page-a-only' })
    a.selection.set([id])
    const svcA = a.ctx.get<ClipboardService>('clipboard')
    svcA.copy()
    let raw = ''
    svcA.markSystemClipboard((mime, data) => {
      if (mime && mime === 'application/x-mini-canvas-nodes') raw = data
      return true
    })
    const parsed = parseCanvasClipboardText(raw)
    expect(parsed).toBeTruthy()

    const payload = buildClipboardPastePayload(
      pasteEvent({ types: ['application/x-mini-canvas-nodes'], data: { 'application/x-mini-canvas-nodes': canvasClipboardPayload(parsed!.nodes, parsed!.edges, parsed!.copyTime) } }),
    )
    expect(pasteEntry(b.ctx)(payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 30))

    const pasted = b.nodeStore.getNodes().find((n) => n.type === 'image')!
    // blob: 死链换成本页按引用重建出来的地址（否则图是空白）
    expect(pasted.data.imageUrl).toBe('blob:resolved-res-9')
    expect(pasted.data.resourceId).toBe('res-9')
  })

  it('菜单/面板的「粘贴」命令：没有原生事件，也能跨页面贴（异步读系统剪贴板）', async () => {
    const a = makeCtx()
    const b = otherPage()
    await a.ctx.start()
    await b.ctx.start()

    const id = addNode(a.nodeStore, 'text', 40, 40, { label: '文本 1' })
    a.selection.set([id])
    const svcA = a.ctx.get<ClipboardService>('clipboard')
    svcA.copy()
    let clipText = ''
    svcA.markSystemClipboard((mime, data) => {
      if (mime === 'text/plain') clipText = data
      return true
    })

    // 模拟系统剪贴板里就是 A 写的那一份：B 读剪贴板得到同一串文本
    const original = (globalThis as { navigator?: unknown }).navigator
    // navigator 在 Node 里只有 getter，用 defineProperty 顶替（测试环境补齐，产品代码不变）
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: { clipboard: { readText: async () => clipText } },
    })
    try {
      const svcB = b.ctx.get<ClipboardService>('clipboard')
      expect(svcB.hasData).toBe(false) // 另一个页面没有内存快照
      expect(svcB.pasteFromCommand()).toBe(true)
      await new Promise((r) => setTimeout(r, 30))
      expect(b.nodeStore.getNodes()).toHaveLength(1)
      expect(b.nodeStore.getNodes()[0].data.label).toBe('文本 1')

      // 再点一次「粘贴」还能再贴一份（读剪贴板是异步的，若与事件路径共用一份内存快照，
      // 第一次的异步落地会把内存快照覆盖成 1 个节点，这里就是那个回归点）
      expect(svcB.pasteFromCommand()).toBe(true)
      await new Promise((r) => setTimeout(r, 30))
      expect(b.nodeStore.getNodes()).toHaveLength(2)
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: original })
    }
  })

  it('菜单路径在同页复制时优先贴内存快照（不依赖剪贴板读权限）', async () => {
    const { ctx, nodeStore, selection } = makeCtx()
    installResources(ctx)
    const a = addNode(nodeStore, 'text', 0, 0, { label: '文本 1' })
    selection.set([a])
    await ctx.start()
    const svc = ctx.get<ClipboardService>('clipboard')
    svc.copy()
    // 没有 navigator.clipboard（读不到）也能贴 —— 内存快照在
    expect(svc.pasteFromCommand()).toBe(true)
    expect(nodeStore.getNodes()).toHaveLength(2)
  })

  it('旧格式（只有标记、没有载荷）且本页无快照 → 接管并吞掉，不让标记 JSON 被建成文本节点', async () => {
    const b = otherPage()
    await b.ctx.start()
    // 老版本写的剪贴板：带前缀的 text/plain 里只有一个 {"v":1,"nodes":n,"edges":m} 标记
    const marker = 'mini-canvas-nodes:' + JSON.stringify({ v: 1, nodes: 1, edges: 0 })
    const payload = buildClipboardPastePayload(pasteEvent({ types: ['text/plain'], data: { 'text/plain': marker } }))
    // 仍然认领（返回 true）→ 宿主 preventDefault，file-drop 的纯文本处理器不会被问到；
    // 本页没有内存快照 → 不贴任何节点（过去这里会让位，标记 JSON 会被建成一个文本节点）
    expect(pasteEntry(b.ctx)(payload)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(b.nodeStore.getNodes()).toHaveLength(0)
  })
})
