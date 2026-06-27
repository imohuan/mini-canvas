import { reactive, type Component } from 'vue'
import type { MenuItemDefinition, MenuRegistryAPI, CommandContext } from './types'
import type { NodeRegistry } from './NodeRegistry'

/**
 * 菜单注册中心
 *
 * 插件通过 register() 逐条注册菜单项，菜单项通过 commandId 引用命令。
 * CanvasMenu 组件读取这里的数据来渲染右键菜单。
 * 内部使用 reactive Map，注册变化时自动触发 Vue 重渲染。
 *
 * 注册模式：单条注册，同 id 覆盖（与 CommandRegistry、ToolbarRegistry 一致）。
 */
export class MenuRegistry implements MenuRegistryAPI {
  /** 菜单项存储：id -> { source, item } */
  private items = reactive(new Map<string, { source: string; item: MenuItemDefinition }>())

  /**
   * 注册单个菜单项
   *
   * 同 id 后注册的覆盖先注册的，并打 warn 日志。
   */
  register(source: string, item: MenuItemDefinition): void {
    const existing = this.items.get(item.id)
    if (existing) {
      console.warn(
        `[MenuRegistry] Item "${item.id}" is overridden: ` +
        `source "${existing.source}" -> "${source}"`
      )
    }
    this.items.set(item.id, { source, item: { ...item, source } })
  }

  /** 按 id 注销菜单项 */
  unregister(id: string): void {
    this.items.delete(id)
  }

  /** 注销某来源的所有菜单项（插件卸载时调用） */
  unregisterSource(source: string): void {
    for (const [id, entry] of this.items) {
      if (entry.source === source) this.items.delete(id)
    }
  }

  /** 获取所有菜单项（含 source 信息） */
  getAll(): { source: string; item: MenuItemDefinition }[] {
    return [...this.items.values()]
  }

  /**
   * 获取指定区域的菜单项，按 order 排序
   *
   * 如果菜单项没有 areas 字段，则出现在所有区域。
   */
  getByArea(area: string): MenuItemDefinition[] {
    const result: MenuItemDefinition[] = []
    for (const entry of this.items.values()) {
      if (!entry.item.areas || entry.item.areas.includes(area as any)) {
        result.push(entry.item)
      }
    }
    return result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }
}

// ============================================================
// 菜单解析器 — 合并 NodeRegistry + MenuRegistry 生成最终菜单
// ============================================================

/** 菜单上下文 — 描述菜单打开时的画布状态 */
export interface MenuContext {
  mode?: 'pane' | 'node' | 'connection' | 'edge'
  nodeId?: string
  nodeType?: string
  edgeId?: string
  sourceNodeId?: string
  flowPosition?: { x: number; y: number }
  pendingConnection?: {
    sourceNodeId: string
    sourceHandle: string
    tempNodeId: string
    tempEdgeId: string
    flowPosition: { x: number; y: number }
  }
}

export interface ResolvedMenuItem {
  id: string
  label: string
  description?: string
  icon?: string | Component
  badge?: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  group: string
  order?: number
  /** 创建节点菜单项的节点类型（如 text, image），非创建类菜单项为空 */
  nodeType?: string
}

const GROUP_ORDER: Record<string, number> = { create: 1, action: 2, delete: 3 }

function toCommandContext(ctx: MenuContext): CommandContext {
  return {
    runtime: null,
    actions: null,
    selection: null,
    viewport: null,
    store: null,
    logger: console,
    nodeType: ctx.nodeType,
    position: ctx.flowPosition,
  }
}

function evaluateVisible(item: MenuItemDefinition, ctx: MenuContext): boolean {
  if (item.visible === undefined) return true
  if (typeof item.visible === 'boolean') return item.visible
  try { return item.visible(toCommandContext(ctx)) }
  catch { return false }
}

function evaluateDisabled(item: MenuItemDefinition, ctx: MenuContext): boolean {
  if (item.disabled === undefined) return false
  if (typeof item.disabled === 'boolean') return item.disabled
  try { return item.disabled(toCommandContext(ctx)) }
  catch { return true }
}

function createNodeItems(ctx: MenuContext, nodeRegistry: NodeRegistry): ResolvedMenuItem[] {
  if (ctx.mode !== 'pane' && ctx.mode !== 'connection') return []
  const prefix = ctx.mode === 'connection' ? 'connect:' : 'create:'
  return nodeRegistry.getMenuItems().map((item, index) => ({
    id: prefix + item.id,
    label: item.label,
    description: item.description,
    icon: item.icon,
    badge: item.badge,
    group: 'create',
    order: 100 - index,
    nodeType: item.id,
  }))
}

/** 解析菜单项：合并 NodeRegistry（创建节点）和 MenuRegistry（操作命令） */
export function resolveMenuItems(
  ctx: MenuContext,
  menuRegistry: MenuRegistry,
  nodeRegistry: NodeRegistry,
): ResolvedMenuItem[] {
  const items: ResolvedMenuItem[] = createNodeItems(ctx, nodeRegistry)

  const area = ctx.mode || "pane"
  const registeredItems = menuRegistry.getByArea(area)

  for (const item of registeredItems) {
    if (item.nodeTypes && item.nodeTypes.length > 0) {
      if (ctx.nodeType && !item.nodeTypes.includes(ctx.nodeType)) continue
      if (!ctx.nodeType) continue
    }

    if (!evaluateVisible(item, ctx)) continue

    const disabled = evaluateDisabled(item, ctx)

    items.push({
      id: item.id,
      label: item.title || item.id,
      description: item.description,
      icon: item.icon,
      badge: item.badge,
      shortcut: item.shortcut,
      danger: item.danger,
      disabled,
      group: item.group || 'action',
      order: item.order ?? 0,
    })
  }

  return items.sort((a, b) => {
    const ga = GROUP_ORDER[a.group] ?? 99
    const gb = GROUP_ORDER[b.group] ?? 99
    if (ga !== gb) return ga - gb
    const oa = a.order ?? 0
    const ob = b.order ?? 0
    if (oa !== ob) return ob - oa
    return a.id.localeCompare(b.id)
  })
}
