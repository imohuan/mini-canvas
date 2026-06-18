import type { Component } from 'vue'

export interface PanelSectionDefinition {
  id: string
  label: string
  component: Component
  priority?: number
}

export class PanelRegistry {
  private sections: Map<string, { source: string; definition: PanelSectionDefinition }> = new Map()

  register(source: string, definition: PanelSectionDefinition): void {
    this.sections.set(definition.id, { source, definition })
  }

  unregisterSource(source: string): void {
    for (const [id, entry] of this.sections) {
      if (entry.source === source) this.sections.delete(id)
    }
  }

  getAll(): PanelSectionDefinition[] {
    return [...this.sections.values()]
      .map(e => e.definition)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
  }
}