import type { Component } from 'vue'

export interface ToolbarDefinition {
  id: string
  component: Component
  position: 'top' | 'bottom'
  priority?: number
}

export class ToolbarRegistry {
  private items: Map<string, { source: string; definition: ToolbarDefinition }> = new Map()

  register(source: string, definition: ToolbarDefinition): void {
    this.items.set(definition.id, { source, definition })
  }

  unregisterSource(source: string): void {
    for (const [id, entry] of this.items) {
      if (entry.source === source) this.items.delete(id)
    }
  }

  getAll(): ToolbarDefinition[] {
    return [...this.items.values()]
      .map(e => e.definition)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  }
}