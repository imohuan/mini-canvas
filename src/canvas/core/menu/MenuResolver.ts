import type { NodeRegistry } from '../registry/NodeRegistry'
import type { MenuContext, MenuItemDefinition, MenuRegistry } from './MenuRegistry'

export interface ResolvedMenuItem {
  id: string
  label: string
  description?: string
  icon?: MenuItemDefinition['icon']
  badge?: string
  shortcut?: string
  danger?: boolean
  group: string
  priority?: number
}

const GROUP_ORDER: Record<string, number> = { create: 1, action: 2, delete: 3 }

function createNodeItems(ctx: MenuContext, nodeRegistry: NodeRegistry): ResolvedMenuItem[] {
  if (ctx.mode !== 'pane' && ctx.mode !== 'connection') return []
  const prefix = ctx.mode === 'connection' ? 'connect:' : 'create:'
  return nodeRegistry.getMenuItems().map((item, index) => ({
    id: `${prefix}${item.id}`,
    label: item.label,
    description: item.description,
    icon: item.icon,
    badge: item.badge,
    group: 'create',
    priority: 100 - index,
  }))
}

export function resolveMenuItems(ctx: MenuContext, menuRegistry: MenuRegistry, nodeRegistry: NodeRegistry): ResolvedMenuItem[] {
  const items: ResolvedMenuItem[] = createNodeItems(ctx, nodeRegistry)

  for (const entry of menuRegistry.getAll()) {
    try {
      if (!entry.item.visible(ctx)) continue
      items.push({
        id: entry.item.id,
        label: entry.item.label,
        description: entry.item.description,
        icon: entry.item.icon,
        badge: entry.item.badge,
        shortcut: entry.item.shortcut,
        danger: entry.item.danger,
        group: entry.item.group || 'action',
        priority: entry.item.priority ?? 0,
      })
    } catch (err) {
      console.warn(`[MenuResolver] visible() failed for ${entry.item.id}:`, err)
    }
  }

  return items.sort((a, b) => {
    const ga = GROUP_ORDER[a.group] ?? 99
    const gb = GROUP_ORDER[b.group] ?? 99
    if (ga !== gb) return ga - gb
    const pa = a.priority ?? 0
    const pb = b.priority ?? 0
    if (pa !== pb) return pb - pa
    return a.id.localeCompare(b.id)
  })
}