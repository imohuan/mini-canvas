/**
 * plugin-multi-select —— 多选/全选/清除 交互插件（v2 复刻老版 multi-select 的核心选中交互）。
 *
 * 分层说明：
 * - 框选视觉与"框选手势→选中集"由渲染层(VueFlow 原生 Shift+拖 框选 + CanvasHost selection-end 回流内核)提供；
 *   本插件不重复造框选。
 * - 本插件负责"选中集"的交互命令与对外服务：
 *   - Ctrl+A 全选画布内全部节点（跳过输入框内）；
 *   - Escape 清空选中；
 *   - 上架 'multi-select' 服务供其它插件读选中态/触发全选清空（对齐 v1 MultiSelectAPI）。
 *
 * 依赖：nodeStore/selection 硬依赖（宿主恒在）；无 UI、无 Vue 组件。
 */
import { Service, type PluginModule, type Context } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SelectionService,
  CanvasNode,
} from '@mini-canvas/canvas-core-v2'

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

/** 是否为可编辑目标（input/textarea/contentEditable）：这些场景不劫持快捷键 */
function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return Boolean(t.closest('input, textarea, select, [contenteditable="true"]'))
}

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

  // 2. 快捷键：Ctrl+A 全选、Escape 清空（window keydown，跳过可编辑目标）
  // 快捷键绑定仅在浏览器环境执行（node 装配/测试下守卫跳过；副作用经 ctx.effect 自动回收）
  ctx.effect(() => {
    if (typeof window === 'undefined') return
    function onKeydown(e: KeyboardEvent): void {
      if (isEditableTarget(e.target)) return
      handleMultiSelectKey(e, svc)
    }
    window.addEventListener('keydown', onKeydown)
    return () => window.removeEventListener('keydown', onKeydown)
  })

  // 3. 命令：全选 / 清除（带 UI 元数据，供菜单/工具栏渲染）
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

