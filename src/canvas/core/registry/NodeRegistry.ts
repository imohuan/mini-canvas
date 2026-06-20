import type { Component } from 'vue'

export interface NodeMenuItemDefinition {
  label: string
  description?: string
  icon?: 'text' | 'image' | 'video' | 'layers' | 'link' | 'delete' | 'duplicate'
  badge?: string
}

export interface CanvasNodeDefinition {
  /** 来源（插件名或 'core'），用于批量卸载 */
  source?: string
  /** 排序，数字越小越靠前 */
  order?: number
  type: string
  node?: Component
  label: string
  defaultSize: { cardWidth: number; cardHeight: number }
  menuItem: NodeMenuItemDefinition
  canReceiveInput?: boolean
  resizable?: boolean
}

export interface CanvasNodeMenuItem {
  id: string
  label: string
  description?: string
  icon?: NodeMenuItemDefinition['icon']
  badge?: string
}

const FALLBACK_SIZE = { cardWidth: 256, cardHeight: 256 }

export class NodeRegistry {
  private definitions = new Map<string, CanvasNodeDefinition>()

  register(definition: CanvasNodeDefinition): void {
    this.definitions.set(definition.type, definition)
  }

  unregister(type: string): void {
    this.definitions.delete(type)
  }

  get(type: string): CanvasNodeDefinition | null {
    return this.definitions.get(type) ?? null
  }

  getAllTypes(): string[] {
    return [...this.definitions.keys()]
  }

  getDefaultSize(type: string): { cardWidth: number; cardHeight: number } {
    return this.definitions.get(type)?.defaultSize ?? FALLBACK_SIZE
  }

  getLabel(type: string): string {
    return this.definitions.get(type)?.label ?? type
  }

  canReceiveInput(type: string): boolean {
    return this.definitions.get(type)?.canReceiveInput ?? true
  }

  isResizable(type: string): boolean {
    return this.definitions.get(type)?.resizable ?? false
  }

  getMenuItems(): CanvasNodeMenuItem[] {
    return [...this.definitions.values()].map(definition => ({
      id: definition.type,
      label: definition.menuItem.label,
      description: definition.menuItem.description,
      icon: definition.menuItem.icon,
      badge: definition.menuItem.badge,
    }))
  }
}
