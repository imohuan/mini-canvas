import type { Component } from 'vue'

export interface DialogDefinition {
  id: string
  component: Component
  title?: string
}

export class DialogRegistry {
  private dialogs: Map<string, { source: string; definition: DialogDefinition }> = new Map()

  register(source: string, definition: DialogDefinition): void {
    this.dialogs.set(definition.id, { source, definition })
  }

  unregisterSource(source: string): void {
    for (const [id, entry] of this.dialogs) {
      if (entry.source === source) this.dialogs.delete(id)
    }
  }

  getAll(): DialogDefinition[] {
    return [...this.dialogs.values()].map(e => e.definition)
  }
}