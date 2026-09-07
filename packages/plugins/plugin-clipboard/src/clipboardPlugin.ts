/**
 * plugin-clipboard —— 复制/粘贴/剪切/复制一份（v2 复刻老版 canvas-core/src/plugins/clipboard）。
 *
 * 数据流（v2 铁律：只经内核服务读写，不碰 VueFlow/宿主内部；整段原子进 history 一次撤销）：
 * - 复制：读 ctx.selection.ids(节点桶) → nodeStore 取节点深拷贝 + edgeStore 取"两端都在选中集"的边
 *         → 存模块级剪贴板快照（跨插件共享，与老版全局 clipboard 语义一致）；
 * - 粘贴：克隆快照 → 新 id 重映射(节点 + 边 source/target) → 偏移(有鼠标锚点居中/无则级联 +20)
 *         → nodeStore.addNodes + edgeStore.addEdge → 选中切到新粘贴节点；
 * - 剪切：复制 + 删选中(节点 + 触碰边)，整段 history 一次；
 * - 复制一份：copy + paste 组合（快捷键 mod+d）。
 *
 * 快捷键：不用插件自绑 window，命令 keys 字段由渲染层 CanvasHost 统一分发（masterplan 铁律 7）。
 * 类型缝：declare module 给 ctx.clipboard 直访（对齐 multi-select 的 'multi-select' 服务写法）。
 *
 * 依赖注入：nodeStore/edgeStore/selection/history 为宿主恒在硬依赖（canvas-core-v2 包注入）;
 * viewport 由 canvas-render 宿主注入、本插件只做"可选读取"（复制时把最近鼠标屏幕坐标经它换成 flow 锚点）。
 */
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SelectionService,
  HistoryService,
  EdgeStoreService,
  CanvasNode,
} from '@mini-canvas/canvas-core-v2'
import type { ViewportService } from '@mini-canvas/canvas-render'
import {
  makeSnapshot,
  internalEdgesOf,
  touchingEdgesOf,
  toClipboardNodes,
  toClipboardEdges,
  computePasteOffset,
  remapSnapshot,
  type ClipboardSnapshot,
  type ClipboardNode,
} from './clipboardEngine'

/** 剪贴板对外服务形状（其它插件/UI 读选中复制粘贴） */
export interface ClipboardService {
  /** 复制当前选中节点(+内连边)到剪贴板；无选中返回 false */
  copy(): boolean
  /** 粘贴剪贴板内容到画布(鼠标锚点居中/级联偏移)；剪贴板空返回 false */
  paste(): boolean
  /** 剪切当前选中节点(+内连边)到剪贴板并删除；无选中返回 false */
  cut(): boolean
  /** 复制一份当前选中（copy+paste 原子）；无选中返回 false */
  duplicate(): boolean
  /** 是否有可粘贴的剪贴板数据 */
  readonly hasData: boolean
}

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    clipboard: ClipboardService
  }
}

export const name = 'clipboard'
export const inject = ['nodeStore', 'edgeStore', 'selection', 'history'] as string[]

/** 可编辑输入框内不响应粘贴快捷键（与宿主 CanvasHost keydown 同规则；复制 ctrl+c 也避开） */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return Boolean(t.closest('input, textarea, select, [contenteditable="true"]'))
}

class ClipboardServiceImpl extends Service implements ClipboardService {
  /** 跨实例共享剪贴板（全局同画布多份 host 也能互贴；与老版模块级 clipboard 一致） */
  private static shared: ClipboardSnapshot | null = null
  /** 模块级粘贴计数（级联偏移用；copy/cut 时清零） */
  private static pasteCount = 0
  /** 最近一次画布内鼠标位置（屏幕坐标；pane mousemove 经 viewport 转 flow 锚点） */
  private lastClient: { x: number; y: number } | null = null

  constructor(ctx: Context) {
    super(ctx, 'clipboard')
  }

  private get nodeStore(): NodeStoreService {
    return this.ctx.get<NodeStoreService>('nodeStore')
  }
  private get edgeStore(): EdgeStoreService {
    return this.ctx.get<EdgeStoreService>('edgeStore')
  }
  private get selection(): SelectionService {
    return this.ctx.get<SelectionService>('selection')
  }
  private get history(): HistoryService {
    return this.ctx.get<HistoryService>('history')
  }
  /** 可选：canvas-render 宿主注入的视口服务；无则 null（粘贴退级联偏移） */
  private get viewport(): ViewportService | undefined {
    return this.ctx.get<ViewportService | undefined>('viewport') ?? undefined
  }

  get hasData(): boolean {
    return ClipboardServiceImpl.shared !== null && ClipboardServiceImpl.shared.nodes.length > 0
  }

  /** 当前选中节点对象数组（节点桶） */
  private selectedNodes(): CanvasNode[] {
    const ids = this.selection.ids
    if (ids.size === 0) return []
    return this.nodeStore.getNodes().filter((n) => ids.has(n.id))
  }

  /** 复制选中节点(+两端都在选的内连边)到共享剪贴板 */
  copy(): boolean {
    const nodes = this.selectedNodes()
    if (nodes.length === 0) return false
    const edges = internalEdgesOf(this.edgeStore.getEdges(), this.selection.ids)
    ClipboardServiceImpl.shared = makeSnapshot(
      toClipboardNodes(nodes),
      toClipboardEdges(edges),
    )
    ClipboardServiceImpl.pasteCount = 0
    this.ctx.emit('clipboard:copy', { nodeCount: nodes.length, edgeCount: edges.length })
    return true
  }

  /** 粘贴：克隆快照 + 重映射 + 偏移 + 原子写入 + 选中新节点 */
  paste(): boolean {
    const snap = ClipboardServiceImpl.shared
    if (!snap || snap.nodes.length === 0) return false
    const anchor = this.flowAnchor()
    const offset = computePasteOffset(snap.nodes, anchor, ClipboardServiceImpl.pasteCount)
    const { nodes, edges } = remapSnapshot(snap, offset)
    if (nodes.length === 0) return false

    const added: string[] = []
    this.history.withRecord(() => {
      // 一次原子批量插入克隆节点（显式新 id → 边重连有确定映射；单次 add 广播）
      this.nodeStore.addNodes(
        nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: n.data,
          ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
          ...(n.size !== undefined ? { size: n.size } : {}),
        })),
      )
      for (const n of nodes) added.push(n.id)
      // 边按新 id 重连（edgeStore.addEdge 会按 source/target 生成稳定 id，不会撞已有边）
      for (const e of edges) {
        this.edgeStore.addEdge({
          source: e.source,
          target: e.target,
          ...(e.type !== undefined ? { type: e.type } : {}),
          ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
          ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
        })
      }
    })
    ClipboardServiceImpl.pasteCount += 1
    // 选中切到本次粘贴节点（保持"粘贴后可整体拖动/删除"）；清边选
    this.selection.set(added)
    this.selection.clearEdges()
    this.ctx.emit('clipboard:paste', {
      nodeCount: added.length,
      edgeCount: edges.length,
      position: offset,
    })
    return true
  }

  /** 剪切：先复制(进剪贴板)，再删选中节点+触碰边（history 一次，可撤销） */
  cut(): boolean {
    const nodes = this.selectedNodes()
    if (nodes.length === 0) return false
    const allEdges = this.edgeStore.getEdges()
    const internalEdges = internalEdgesOf(allEdges, this.selection.ids)
    ClipboardServiceImpl.shared = makeSnapshot(
      toClipboardNodes(nodes),
      toClipboardEdges(internalEdges),
    )
    ClipboardServiceImpl.pasteCount = 0
    const nodeIds = nodes.map((n) => n.id)
    const touching = touchingEdgesOf(allEdges, nodeIds)
    this.history.withRecord(() => {
      this.nodeStore.removeNodes(nodeIds) // 删父自动清子引用；子被独立删也会连带自己的边
      for (const e of touching) this.edgeStore.removeEdge(e.id)
      // 兜底：删节点连带删边（removeNodes 不删边，需显式清）
      for (const id of nodeIds) this.edgeStore.removeEdgesOfNode(id)
    })
    this.selection.clear()
    this.ctx.emit('clipboard:cut', { nodeCount: nodes.length, edgeCount: touching.length })
    return true
  }

  /** 复制一份 = copy + paste */
  duplicate(): boolean {
    if (!this.copy()) return false
    return this.paste()
  }

  /**
   * 记录最近一次画布鼠标位置（供粘贴居中锚点；模块逻辑监听 window pointermove，非宿主内部）。
   * 由 apply 里 ctx.effect 装配：ctx.on 事件 / DOM 监听都随插件 scope 自动回收。
   */
  trackClientPoint(x: number, y: number): void {
    this.lastClient = { x, y }
  }

  /** 最近鼠标屏幕坐标 → flow 锚点（viewport 未就绪/无坐标返回 null → 级联偏移） */
  private flowAnchor(): { x: number; y: number } | null {
    if (!this.lastClient) return null
    const vp = this.viewport
    if (!vp) return null
    return vp.screenToFlow(this.lastClient.x, this.lastClient.y)
  }
}

/** 装配入口（cordis 形态） */
export function apply(ctx: Context): void {
  const svc = new ClipboardServiceImpl(ctx)

  // 追踪画布鼠标位置：只在浏览器环境绑 window pointermove（node 测试/装配跳过），
  // ctx.effect 包 DOM 监听 → 插件卸载自动解绑。
  ctx.effect(() => {
    if (typeof window === 'undefined') return
    function onPointerMove(e: PointerEvent): void {
      // 跳过可编辑目标内的拖动（粘贴锚点不该被输入框内指针污染）
      if (isEditableTarget(e.target)) return
      // 只在指针位于画布区域(.vue-flow，VueFlow 渲染约定，与 canvas-export 同源)时记录：
      // 避免把工具栏/侧边栏上的鼠标误当"粘贴锚点"
      const el = e.target as HTMLElement | null
      if (!el || !el.closest('.vue-flow')) return
      svc.trackClientPoint(e.clientX, e.clientY)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  })

  // 命令：快捷键 keys 由渲染层 CanvasHost 统一分发（不插件自绑 window）
  ctx.commands.register({
    id: 'clipboard:copy',
    title: '复制选中节点',
    keys: ['mod+c'],
    areas: ['pane'],
    group: 'clipboard',
    order: 10,
    run: () => svc.copy(),
  })
  ctx.commands.register({
    id: 'clipboard:paste',
    title: '粘贴',
    keys: ['mod+v'],
    areas: ['pane'],
    group: 'clipboard',
    order: 20,
    run: () => svc.paste(),
  })
  ctx.commands.register({
    id: 'clipboard:cut',
    title: '剪切选中节点',
    keys: ['mod+x'],
    areas: ['pane'],
    group: 'clipboard',
    order: 30,
    run: () => svc.cut(),
  })
  ctx.commands.register({
    id: 'clipboard:duplicate',
    title: '复制一份选中节点',
    keys: ['mod+d'],
    areas: ['pane'],
    group: 'clipboard',
    order: 40,
    run: () => svc.duplicate(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const clipboardPlugin: PluginModule = { name, inject, apply }
