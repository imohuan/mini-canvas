import type { PluginModule } from './types'

/**
 * topoSort —— 依赖拓扑排序（纯函数，从 v1 PluginManager.resolveOrder 吸收）。
 *
 * 规则（与 v1 一致）：
 * - A 的 deps 含 B ⇒ B 必须先于 A（Kahn，B 的入度先清）。
 * - 重复名 / 自依赖 / 缺失依赖 / 循环依赖均抛错，循环给出可读路径。
 *
 * @param plugins 插件列表（含 name + deps）
 * @returns 按依赖顺序排列的 name 数组（依赖在前）
 * @throws 非法依赖关系时抛 Error
 */
export function topoSort(plugins: Array<Pick<PluginModule, 'name' | 'deps'>>): string[] {
  // ---- 1. 重复名检测 ----
  const seen = new Set<string>()
  for (const p of plugins) {
    if (seen.has(p.name)) {
      throw new Error(`[core] Duplicate plugin name: "${p.name}"`)
    }
    seen.add(p.name)
  }

  const names = new Set(plugins.map((p) => p.name))

  // 邻接表：dependentsOf[x] = 依赖 x 的插件列表（x 必须先装）
  const dependentsOf = new Map<string, string[]>()
  const inDegree = new Map<string, number>()

  for (const p of plugins) {
    if (!inDegree.has(p.name)) inDegree.set(p.name, 0)
    if (!dependentsOf.has(p.name)) dependentsOf.set(p.name, [])
  }

  for (const p of plugins) {
    for (const dep of p.deps ?? []) {
      if (dep === p.name) {
        throw new Error(`[core] Plugin "${p.name}" cannot depend on itself`)
      }
      if (!names.has(dep)) {
        throw new Error(
          `[core] Plugin "${p.name}" depends on "${dep}" which is not registered`,
        )
      }
      inDegree.set(p.name, (inDegree.get(p.name) ?? 0) + 1)
      if (!dependentsOf.has(dep)) dependentsOf.set(dep, [])
      dependentsOf.get(dep)!.push(p.name)
    }
  }

  // ---- Kahn ----
  const queue: string[] = []
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name)
  }

  const sorted: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    sorted.push(current)
    for (const dependent of dependentsOf.get(current) ?? []) {
      const nd = (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, nd)
      if (nd === 0) queue.push(dependent)
    }
  }

  if (sorted.length !== plugins.length) {
    const remaining = new Set(names)
    for (const n of sorted) remaining.delete(n)
    throw new Error(`[core] Circular dependency detected: ${buildCyclePath(plugins, remaining)}`)
  }

  return sorted
}

/** 构建循环依赖的可读路径（吸收 v1 buildCyclePath）。A 依赖 B ⇒ A → B。 */
function buildCyclePath(
  plugins: Array<Pick<PluginModule, 'name' | 'deps'>>,
  remaining: Set<string>,
): string {
  const dependsOn = new Map<string, string[]>()
  for (const p of plugins) dependsOn.set(p.name, p.deps ?? [])

  const visited = new Set<string>()
  const inStack = new Set<string>()
  const stack: string[] = []

  function dfs(node: string): string[] | null {
    visited.add(node)
    inStack.add(node)
    stack.push(node)

    for (const dep of dependsOn.get(node) ?? []) {
      if (!remaining.has(dep)) continue
      if (!visited.has(dep)) {
        const r = dfs(dep)
        if (r) return r
      } else if (inStack.has(dep)) {
        const start = stack.indexOf(dep)
        return [...stack.slice(start), dep]
      }
    }

    stack.pop()
    inStack.delete(node)
    return null
  }

  const start = remaining.values().next().value
  if (start) {
    const cycle = dfs(start)
    if (cycle && cycle.length > 0) return cycle.join(' → ')
  }
  return Array.from(remaining).join(' → ')
}
