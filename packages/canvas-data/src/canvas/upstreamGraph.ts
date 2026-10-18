/**
 * upstreamGraph —— 画布“上游/依赖”遍历的纯函数。
 *
 * 只依赖“节点表 + 边表”，前端（doc）与后台（CanvasDocument.read()）共用。
 * 设计要点：
 * - 不递归，用显式栈，长链路不会爆栈；
 * - 环检测：cycle='error' 抛错，'skip' 跳过回边；
 * - 结果稳定：同层按边加入序 + 节点 id 排序兜底。
 */

import { isTransient } from '../transient'

export interface GraphNodeLike {
  id: string
  type: string
  data?: Record<string, unknown>
}

export interface GraphEdgeLike {
  source: string
  target: string
  data?: Record<string, unknown>
}

export interface UpstreamGraphInput {
  nodes: readonly GraphNodeLike[]
  edges: readonly GraphEdgeLike[]
}

export interface UpstreamTraversalOptions {
  /** 是否跨过分组节点继续向上（缺省 false：分组是容器，不是数据源） */
  includeGroups?: boolean
  /** 是否包含中间态节点（拖线占位卡；缺省 false） */
  includeTransient?: boolean
  /** 最大层数；缺省不限 */
  maxDepth?: number
  /** 环处理：'skip' 跳过回边（缺省），'error' 抛错 */
  cycle?: 'skip' | 'error'
}

export class UpstreamCycleError extends Error {
  constructor(readonly nodes: string[]) {
    super('[upstream] 依赖出现环：' + nodes.join(' -> '))
    this.name = 'UpstreamCycleError'
  }
}

/** 分组节点类型名（容器，不是数据源） */
export const GROUP_NODE_TYPE = 'group'

/** 建“target → source[]”反向索引；只保留真实边 */
export function buildParentIndex(
  graph: UpstreamGraphInput,
  options: UpstreamTraversalOptions = {},
): Map<string, string[]> {
  const includeTransient = options.includeTransient === true
  const includeGroups = options.includeGroups === true
  const groupIds = new Set<string>()
  if (!includeGroups) {
    for (const n of graph.nodes) if (n.type === GROUP_NODE_TYPE) groupIds.add(n.id)
  }
  const parents = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (!includeTransient && isTransient(e)) continue
    if (groupIds.has(e.source)) continue
    const list = parents.get(e.target) ?? []
    if (!list.includes(e.source)) list.push(e.source)
    parents.set(e.target, list)
  }
  return parents
}

/** 直接上游（一层） */
export function directUpstreamOf(
  graph: UpstreamGraphInput,
  id: string,
  options: UpstreamTraversalOptions = {},
): string[] {
  return [...(buildParentIndex(graph, options).get(id) ?? [])]
}

/**
 * 整条祖先集合（去重，不含自己）。
 * 用显式栈迭代；遇到环按 options.cycle 处理。
 */
export function collectAncestors(
  graph: UpstreamGraphInput,
  startId: string,
  options: UpstreamTraversalOptions = {},
): string[] {
  const parents = buildParentIndex(graph, options)
  const maxDepth = options.maxDepth ?? Infinity
  const seen = new Set<string>()
  const order: string[] = []

  if (options.cycle === 'error') {
    const state = new Map<string, 0 | 1 | 2>()
    const visit = (id: string, depth: number): void => {
      const s = state.get(id) ?? 0
    if (s === 1) throw new UpstreamCycleError([...state.entries()].filter(([, v]) => v === 1).map(([k]) => k))
      if (s === 2) return
      state.set(id, 1)
      if (depth < maxDepth) {
        for (const p of parents.get(id) ?? []) visit(p, depth + 1)
      }
      state.set(id, 2)
      if (id !== startId) {
        seen.add(id)
        order.push(id)
      }
    }
    visit(startId, 0)
    return order
  }

  const stack: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }]
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!
    if (depth >= maxDepth) continue
    for (const p of parents.get(id) ?? []) {
      if (seen.has(p)) continue
      seen.add(p)
      order.push(p)
      stack.push({ id: p, depth: depth + 1 })
    }
  }
  return order
}

/**
 * 从末端倒推的拓扑序：上游先出，startId 最后。
 * 分叉/菱形依赖只出现一次；有环时按 options.cycle 处理。
 */
export function topoOrderFrom(
  graph: UpstreamGraphInput,
  startId: string,
  options: UpstreamTraversalOptions = {},
): string[] {
  const parents = buildParentIndex(graph, options)
  const maxDepth = options.maxDepth ?? Infinity
  const state = new Map<string, 0 | 1 | 2>()
  const out: string[] = []

  const visit = (id: string, depth: number): void => {
    const s = state.get(id) ?? 0
    if (s === 2) return
    if (s === 1) {
      if (options.cycle === 'error') {
        throw new UpstreamCycleError([...state.entries()].filter(([, v]) => v === 1).map(([k]) => k))
      }
      return
    }
    state.set(id, 1)
    if (depth < maxDepth) {
      const ps = [...(parents.get(id) ?? [])]
      // 稳定顺序：边加入序已保留；这里再按 id 兜底，避免依赖 Map 迭代顺序
      ps.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      for (const p of ps) visit(p, depth + 1)
    }
    state.set(id, 2)
    out.push(id)
  }

  visit(startId, 0)
  return out
}

/** 从末端倒推的最大层数（直接上游 = 1；无上游 = 0） */
export function upstreamDepth(
  graph: UpstreamGraphInput,
  startId: string,
  options: UpstreamTraversalOptions = {},
): number {
  const parents = buildParentIndex(graph, options)
  const seen = new Set<string>()
  let max = 0
  const stack: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }]
  while (stack.length > 0) {
    const { id, depth } = stack.pop()!
    for (const p of parents.get(id) ?? []) {
      if (seen.has(p)) continue
      seen.add(p)
      const next = depth + 1
      if (next > max) max = next
      stack.push({ id: p, depth: next })
    }
  }
  return max
}
