export interface MenuContext {
  mode: 'pane' | 'node' | 'connection' | 'edge'
  nodeId?: string
  nodeType?: string
  edgeId?: string
  sourceNodeId?: string
  flowPosition?: { x: number; y: number }
}

export interface MenuItemDefinition {
  id: string
  label: string
  description?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
  badge?: string
  shortcut?: string
  danger?: boolean
  group?: 'create' | 'action' | 'delete'
  priority?: number
  visible: (ctx: MenuContext) => boolean
}

interface RegistryEntry {
  source: string
  item: MenuItemDefinition
}

export class MenuRegistry {
  private entries: RegistryEntry[] = []

  register(source: string, items: MenuItemDefinition[]): void {
    this.unregisterSource(source)
    for (const item of items) this.entries.push({ source, item })
  }

  unregister(source: string, ids: string[]): void {
    const idSet = new Set(ids)
    this.entries = this.entries.filter(entry => !(entry.source === source && idSet.has(entry.item.id)))
  }

  unregisterSource(source: string): void {
    this.entries = this.entries.filter(entry => entry.source !== source)
  }

  getAll(): RegistryEntry[] {
    return [...this.entries]
  }
}