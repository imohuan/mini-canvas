import type { CanvasPlugin } from './types'

export class PluginDependencyGraph {
  sort(plugins: CanvasPlugin[]): string[] {
    const names = new Set(plugins.map(p => p.name))
    const dependentsOf = new Map<string, string[]>()
    const inDegree = new Map<string, number>()

    for (const plugin of plugins) {
      if (!inDegree.has(plugin.name)) inDegree.set(plugin.name, 0)
      if (!dependentsOf.has(plugin.name)) dependentsOf.set(plugin.name, [])
    }

    for (const plugin of plugins) {
      if (!plugin.dependencies?.length) continue
      for (const dep of plugin.dependencies) {
        if (dep === plugin.name) throw new Error(`Plugin "${plugin.name}" cannot depend on itself`)
        if (!names.has(dep)) throw new Error(`Plugin "${plugin.name}" depends on "${dep}" which is not registered`)
        inDegree.set(plugin.name, (inDegree.get(plugin.name) || 0) + 1)
        if (!dependentsOf.has(dep)) dependentsOf.set(dep, [])
        dependentsOf.get(dep)!.push(plugin.name)
      }
    }

    const queue: string[] = []
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name)
    }

    const sorted: string[] = []
    while (queue.length > 0) {
      const current = queue.shift()!
      sorted.push(current)
      for (const dependent of dependentsOf.get(current) || []) {
        const newDegree = inDegree.get(dependent)! - 1
        inDegree.set(dependent, newDegree)
        if (newDegree === 0) queue.push(dependent)
      }
    }

    if (sorted.length !== plugins.length) {
      const remaining = new Set(names)
      for (const name of sorted) remaining.delete(name)
      throw new Error(`Circular dependency detected: ${[...remaining].join(' → ')}`)
    }

    return sorted
  }
}