/**
 * plugin-multi-select —— 多选交互插件（v2 复刻老版 canvas-core/src/plugins/multi-select 完整能力）。
 *
 * 对齐老版 MultiSelectPlugin（自绘 Shift+拖框选 + SelectionFrame 群组框 + Ctrl+A/Escape）：
 * - 框选手势：插件自绘蓝色虚线框（CanvasSurface 已禁 VueFlow 原生框选 selectionKeyCode/multiSelectionKeyCode
 *   = null），Shift+左键拖空白 → screenToFlow 换算 → nodeLayout 绝对矩形碰撞 → 实时写内核 selection 单源。
 * - SelectionFrame：选中节点数 > 1 时显示群组虚线框（包围盒 = 选中节点绝对矩形并集 + padding），
 *   框内左键拖动 = 整组移动（逐帧 updateNodeVisual 视觉写 + 松手 history.withRecord 批量落盘），中键=平移。
 * - 快捷键 Ctrl+A/Escape 走命令 keys（宿主 CanvasHost 统一分发），不自绑 window。
 *
 * 分层：
 * - 数据写/选中单源 → 内核 nodeStore/selection/history（宿主恒在注入）。
 * - 几何/实测尺寸/绝对坐标 → 渲染层 nodeLayout 服务；坐标换算/视口 → useCanvasRender。
 * - 框选手势 + SelectionFrame UI → 本插件两个 .vue 组件（注册 overlay 槽，宿主 CanvasSurface 渲染）。
 * - 纯逻辑（碰撞/包围盒/顶层拖动成员）在 multiSelectEngine.ts（零 Vue 可单测）。
 *
 * 依赖方向：只依赖内核服务 + canvas-render 只读上下文/服务；不反向依赖宿主 demo / 其它插件。
 */
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SelectionService, CanvasNode } from '@mini-canvas/canvas-core-v2'
import BoxSelectLayer from './BoxSelectLayer.vue'
import SelectionFrame from './SelectionFrame.vue'

/** multi-select 暴露给外部插件的服务形状 */
export interface MultiSelectService {
  /** 当前选中节点 id 集（只读快照） */
  getSelectedNodeIds(): ReadonlySet<string>
  /** 当前选中节点对象数组（按内核 nodeStore 取） */
  getSelectedNodes(): CanvasNode[]
  /** 是否选中了边 */
  hasSelectedEdges(): boolean
  /** 是否有任何选中（节点或边） */
  hasSelection(): boolean
  /** 全选画布内全部节点（不清边） */
  selectAll(): void
  /** 清空选中（节点与边） */
  clearSelection(): void
}

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    'multi-select': MultiSelectService
  }
}

export const name = 'multi-select'
export const inject = ['nodeStore', 'selection'] as string[]

/** 多选快捷键处理（纯逻辑可单测）：Ctrl/Cmd+A 全选、Escape 清空；返回是否已处理（消费事件） */
export function handleMultiSelectKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'preventDefault'>,
  actions: { selectAll(): void; clearSelection(): void; hasSelection(): boolean },
): boolean {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    actions.selectAll()
    return true
  }
  if (e.key === 'Escape') {
    if (actions.hasSelection()) {
      e.preventDefault()
      actions.clearSelection()
      return true
    }
  }
  return false
}

class MultiSelectServiceImpl extends Service implements MultiSelectService {
  constructor(ctx: Context) {
    super(ctx, 'multi-select')
  }

  private get selection(): SelectionService {
    return this.ctx.get<SelectionService>('selection')
  }
  private get nodeStore(): NodeStoreService {
    return this.ctx.get<NodeStoreService>('nodeStore')
  }

  getSelectedNodeIds(): ReadonlySet<string> {
    return this.selection.ids
  }
  getSelectedNodes(): CanvasNode[] {
    const ids = this.selection.ids
    if (ids.size === 0) return []
    return this.nodeStore.getNodes().filter((n) => ids.has(n.id))
  }
  hasSelectedEdges(): boolean {
    return this.selection.edgeIds.size > 0
  }
  hasSelection(): boolean {
    return this.selection.size > 0
  }
  selectAll(): void {
    const all = this.nodeStore.getNodes().map((n) => n.id)
    this.selection.set(all)
  }
  clearSelection(): void {
    this.selection.clear()
  }
}

export function apply(ctx: Context) {
  // 1. 上架服务（构造即 super(ctx,'multi-select') 上架）
  const svc = new MultiSelectServiceImpl(ctx)

  // 2. 自绘框选浮层 + SelectionFrame 群组框 → overlay 槽（宿主 CanvasSurface 渲染，
  //    组件内 useCanvasRender 读 pane/viewport/screenToFlow；热卸随插件 scope 自动移除）
  ctx.slots.register('overlay', {
    id: 'multi-select-box',
    order: 30,
    component: BoxSelectLayer,
    meta: { title: 'Shift+拖拽框选' },
  })
  ctx.slots.register('overlay', {
    id: 'multi-select-frame',
    order: 40,
    component: SelectionFrame,
    meta: { title: '多选群组框' },
  })

  // 3. 命令：全选 / 清除（keys 由宿主 CanvasHost 统一分发；热卸随 scope 自动回收）
  ctx.commands.register({
    id: 'multi-select:select-all',
    title: '全选节点',
    keys: ['mod+a'],
    areas: ['pane'],
    order: 10,
    run: () => svc.selectAll(),
  })
  ctx.commands.register({
    id: 'multi-select:clear',
    title: '清除选中',
    keys: ['Escape'],
    areas: ['pane'],
    order: 20,
    run: () => svc.clearSelection(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const multiSelectPlugin: PluginModule = { name, inject, apply }
