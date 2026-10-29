/**
 * layoutEngine.ts — 嵌套分簇自动布局引擎
 *
 * 算法：
 *  Step 1: 分簇 → 组内节点(簇A) / 连通分量(簇B) / 孤立节点(簇C)
 *  Step 2: 合并 → Union-Find 将跨簇连线关联的簇合并为 Super-Cluster
 *  Step 3: 递归布局 → 子簇内部 dagre → 子簇块级 dagre → 平移子节点
 *  Step 4: 重算 Group bounds → bbox + padding
 *
 * 依赖：dagre (CDN 或 npm)
 */

import type { Node, Edge } from '@vue-flow/core'
import type {
  AutoLayoutConfig,
  LayoutCluster,
  GroupBounds,
} from './types'
import dagre from '@dagrejs/dagre'

// ═══════════════════════════════════════════
// Group padding 常量
// ═══════════════════════════════════════════

const GROUP_PADDING_X = 30
const GROUP_PADDING_Y = 30
const GROUP_PADDING_TOP = 10
const DEFAULT_NODE_W = 200
const DEFAULT_NODE_H = 100

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function getNodeDim(node: Node): { w: number; h: number } {
  const anyNode = node as any
  const style = typeof node.style === 'object' ? node.style : undefined
  return {
    w: anyNode.dimensions?.width
      ?? (style?.width ? parseFloat(String(style.width)) : DEFAULT_NODE_W),
    h: anyNode.dimensions?.height
      ?? (style?.height ? parseFloat(String(style.height)) : DEFAULT_NODE_H),
  }
}

// ═══════════════════════════════════════════
// Step 1: 分簇
// ═══════════════════════════════════════════

export interface ClusterResult {
  clusters: LayoutCluster[]
  logs: string[]
}

export function buildClusters(
  nodes: Node[],
  edges: Edge[],
  groups: { id: string; nodeIds: Set<string> }[],
): ClusterResult {
  const logs: string[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const clusters: LayoutCluster[] = []

  // Step 1a: 组内子节点 → 簇A
  const groupedIds = new Set<string>()
  for (const group of groups) {
    const groupNodes: Node[] = []
    for (const id of group.nodeIds) {
      const n = nodeMap.get(id)
      if (n) { groupNodes.push(n); groupedIds.add(id) }
    }
    if (groupNodes.length > 0) {
      clusters.push({
        id: `group-${group.id}`,
        type: 'group',
        groupId: group.id,
        nodes: groupNodes,
        subClusters: null,
        bounds: null,
      })
    }
  }

  // Step 1b: 连通分量 → 簇B
  const remaining = nodes.filter(n => !groupedIds.has(n.id) && n.type !== 'group')

  // 构建 adjacency
  const adjacency = new Map<string, string[]>()
  for (const n of remaining) { adjacency.set(n.id, []) }
  for (const e of edges) {
    if (adjacency.has(e.source) && adjacency.has(e.target)) {
      adjacency.get(e.source)!.push(e.target)
      adjacency.get(e.target)!.push(e.source)
    }
  }

  const visited = new Set<string>()
  function bfs(startId: string): Node[] {
    const comp: Node[] = []
    const queue = [startId]
    visited.add(startId)
    while (queue.length) {
      const id = queue.shift()!
      const n = nodeMap.get(id)
      if (n) comp.push(n)
      for (const nb of (adjacency.get(id) || [])) {
        if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
      }
    }
    return comp
  }

  for (const n of remaining) {
    if (!visited.has(n.id)) {
      const comp = bfs(n.id)
      if (comp.length > 1) {
        clusters.push({
          id: `connected-${comp.map(c => c.id).join('-')}`,
          type: 'connected',
          nodes: comp,
          subClusters: null,
          bounds: null,
        })
      } else {
        clusters.push({
          id: `single-${comp[0].id}`,
          type: 'single',
          nodes: comp,
          subClusters: null,
          bounds: null,
        })
      }
    }
  }

  logs.push(`Step 1: 分簇完成 → ${clusters.length} 个基础簇`)
  for (const c of clusters) {
    logs.push(`  [${c.type}] ${c.id}: ${c.nodes.map(n => n.data?.label ?? n.id).join(', ')}`)
  }

  // Step 2: Union-Find 合并跨簇连线
  const nodeToCluster = new Map<string, LayoutCluster>()
  for (const c of clusters) {
    for (const n of c.nodes) { nodeToCluster.set(n.id, c) }
  }

  const parent = new Map<LayoutCluster, LayoutCluster>()
  function find(c: LayoutCluster): LayoutCluster {
    if (!parent.has(c)) parent.set(c, c)
    if (parent.get(c) !== c) parent.set(c, find(parent.get(c)!))
    return parent.get(c)!
  }
  function union(a: LayoutCluster, b: LayoutCluster) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const e of edges) {
    const c1 = nodeToCluster.get(e.source)
    const c2 = nodeToCluster.get(e.target)
    if (c1 && c2 && c1 !== c2) {
      union(c1, c2)
    }
  }

  // 将同一 root 的簇合并
  const mergedMap = new Map<LayoutCluster, LayoutCluster[]>()
  for (const c of clusters) {
    const root = find(c)
    if (!mergedMap.has(root)) mergedMap.set(root, [])
    mergedMap.get(root)!.push(c)
  }

  const mergedClusters: LayoutCluster[] = []
  for (const [, subs] of mergedMap) {
    if (subs.length === 1) {
      mergedClusters.push(subs[0])
    } else {
      const allNodes = subs.flatMap(s => s.nodes)
      mergedClusters.push({
        id: `super-${subs.map(s => s.id).join('+')}`,
        type: 'super',
        nodes: allNodes,
        subClusters: subs,
        bounds: null,
      })
    }
  }

  logs.push(`Step 2: 合并跨簇连线 → ${mergedClusters.length} 个簇 (含 ${mergedClusters.filter(c => c.type === 'super').length} 个超级簇)`)
  for (const c of mergedClusters) {
    logs.push(`  [${c.type}] ${c.id} (${c.nodes.length} 节点)`)
  }

  return { clusters: mergedClusters, logs }
}

// ═══════════════════════════════════════════
// Dagre 布局
// ═══════════════════════════════════════════

/**
 * 使用 dagre 对一组节点做内部布局。
 * dagre 输出 center 坐标，这里转为 top-left。
 *
 * @returns 布局后的 bounds { x, y, width, height }，x/y 始终为 0（内部布局不需要偏移）
 */
function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  config: AutoLayoutConfig,
): GroupBounds {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: config.direction,
    nodesep: config.intraSpacing.x,
    ranksep: config.intraSpacing.y,
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const n of nodes) {
    const dim = getNodeDim(n)
    g.setNode(n.id, { width: dim.w, height: dim.h })
  }
  for (const e of edges) {
    if (nodeMap.has(e.source) && nodeMap.has(e.target)) {
      g.setEdge(e.source, e.target)
    }
  }

  dagre.layout(g)

  // 应用位置（dagre 输出中心坐标 → 转 top-left）
  for (const n of nodes) {
    const dn = g.node(n.id)
    if (dn) {
      n.position = { x: dn.x - getNodeDim(n).w / 2, y: dn.y - getNodeDim(n).h / 2 }
    }
  }

  return {
    x: 0,
    y: 0,
    w: g.graph().width || 0,
    h: g.graph().height || 0,
  }
}

// ═══════════════════════════════════════════
// Step 3: 递归布局
// ═══════════════════════════════════════════

export function layoutClusterRecursive(
  cluster: LayoutCluster,
  allEdges: Edge[],
  config: AutoLayoutConfig,
  logs: string[],
): void {
  if (cluster.type === 'single') {
    const dim = getNodeDim(cluster.nodes[0])
    // single 簇也必须归一到局部坐标。
    // 否则上层 super/global 布局加 offset 时，会把旧绝对坐标重复累加，
    // 连续执行自动布局会让单节点离分组越来越远。
    cluster.nodes[0].position = { x: 0, y: 0 }
    cluster.bounds = { x: 0, y: 0, w: dim.w, h: dim.h }
    return
  }

  if (cluster.type === 'group' || cluster.type === 'connected') {
    const nodeMap = new Map(cluster.nodes.map(n => [n.id, n]))
    const internalEdges = allEdges.filter(e => nodeMap.has(e.source) && nodeMap.has(e.target))
    const bounds = layoutWithDagre(cluster.nodes, internalEdges, config)
    cluster.bounds = { x: 0, y: 0, w: bounds.w, h: bounds.h }
    logs.push(`  ↳ [${cluster.type}] ${cluster.id}: 内部排列完成 (${bounds.w.toFixed(0)}x${bounds.h.toFixed(0)})`)
    return
  }

  if (cluster.type === 'super' && cluster.subClusters) {
    // 先递归布局每个子簇
    for (const sub of cluster.subClusters) {
      layoutClusterRecursive(sub, allEdges, config, logs)
    }

    // 块级 dagre：把子簇当作节点布局
    const subG = new dagre.graphlib.Graph()
    subG.setGraph({
      rankdir: config.direction,
      nodesep: config.interSpacing.x,
      ranksep: config.interSpacing.y,
      marginx: 0,
      marginy: 0,
    })
    subG.setDefaultEdgeLabel(() => ({}))

    for (const sub of cluster.subClusters) {
      subG.setNode(sub.id, { width: sub.bounds!.w, height: sub.bounds!.h })
    }

    const subNodeToCluster = new Map<string, LayoutCluster>()
    for (const sub of cluster.subClusters) {
      for (const n of sub.nodes) { subNodeToCluster.set(n.id, sub) }
    }

    const addedEdges = new Set<string>()
    for (const e of allEdges) {
      const sc1 = subNodeToCluster.get(e.source)
      const sc2 = subNodeToCluster.get(e.target)
      if (sc1 && sc2 && sc1 !== sc2) {
        const key = `${sc1.id}→${sc2.id}`
        if (!addedEdges.has(key)) {
          subG.setEdge(sc1.id, sc2.id)
          addedEdges.add(key)
        }
      }
    }

    dagre.layout(subG)

    // 应用偏移
    for (const sub of cluster.subClusters) {
      const dn = subG.node(sub.id)
      if (dn) {
        const offsetX = dn.x - sub.bounds!.w / 2
        const offsetY = dn.y - sub.bounds!.h / 2
        for (const n of sub.nodes) {
          n.position = {
            x: n.position.x + offsetX,
            y: n.position.y + offsetY,
          }
        }
        sub.bounds!.x = offsetX
        sub.bounds!.y = offsetY
      }
    }

    const allX = cluster.subClusters.flatMap(s => [s.bounds!.x, s.bounds!.x + s.bounds!.w])
    const allY = cluster.subClusters.flatMap(s => [s.bounds!.y, s.bounds!.y + s.bounds!.h])
    cluster.bounds = {
      x: Math.min(...allX),
      y: Math.min(...allY),
      w: Math.max(...allX) - Math.min(...allX),
      h: Math.max(...allY) - Math.min(...allY),
    }
    logs.push(`  ↳ [super] ${cluster.id}: ${cluster.subClusters.length} 子簇排列完成`)
  }
}

// ═══════════════════════════════════════════
// Step 4: 重算 Group bounds
// ═══════════════════════════════════════════

/**
 * 根据组内子节点的绝对坐标重新计算 GroupNode 的 bounds。
 * 子节点的 position 在调用前应当是绝对坐标（已用 computedPosition 还原）。
 */
export function calculateGroupBounds(
  groupId: string,
  allNodes: Node[],
): GroupBounds | null {
  const groupNode = allNodes.find(n => n.id === groupId)
  if (!groupNode || groupNode.type !== 'group') return null

  const childNodes = allNodes.filter(n => n.parentNode === groupId)

  if (childNodes.length === 0) {
    // 空组：返回当前位置 + 最小尺寸
    return {
      x: groupNode.position.x,
      y: groupNode.position.y,
      w: 200,
      h: 150,
    }
  }

  // 用 computedPosition 获取子节点的绝对坐标
  // 如果 parentNode !== groupId，说明子节点尚未正式关联，用 position
  const minX = Math.min(...childNodes.map(n => {
    const pos = (n as any).computedPosition || n.position
    return pos.x
  }))
  const minY = Math.min(...childNodes.map(n => {
    const pos = (n as any).computedPosition || n.position
    return pos.y
  }))
  const maxX = Math.max(...childNodes.map(n => {
    const pos = (n as any).computedPosition || n.position
    const dim = getNodeDim(n)
    return pos.x + dim.w
  }))
  const maxY = Math.max(...childNodes.map(n => {
    const pos = (n as any).computedPosition || n.position
    const dim = getNodeDim(n)
    return pos.y + dim.h
  }))

  return {
    x: minX - GROUP_PADDING_X,
    y: minY - GROUP_PADDING_Y - GROUP_PADDING_TOP,
    w: Math.max(maxX - minX + GROUP_PADDING_X * 2, 200),
    h: Math.max(maxY - minY + GROUP_PADDING_Y * 2 + GROUP_PADDING_TOP, 150),
  }
}

// ═══════════════════════════════════════════
// 全局顶级簇布局
// ═══════════════════════════════════════════

export function layoutGlobalClusters(
  clusters: LayoutCluster[],
  edges: Edge[],
  config: AutoLayoutConfig,
  logs: string[],
): void {
  if (clusters.length <= 1) {
    // 单个簇：应用 margin 偏移
    if (clusters.length === 1 && clusters[0].bounds) {
      const margin = 80
      const offsetX = margin - clusters[0].bounds.x
      const offsetY = margin - clusters[0].bounds.y
      for (const n of clusters[0].nodes) {
        n.position = { x: n.position.x + offsetX, y: n.position.y + offsetY }
      }
      clusters[0].bounds.x += offsetX
      clusters[0].bounds.y += offsetY
    }
    return
  }

  const globalG = new dagre.graphlib.Graph()
  globalG.setGraph({
    rankdir: config.direction,
    nodesep: config.interSpacing.x,
    ranksep: config.interSpacing.y,
    marginx: 60,
    marginy: 60,
  })
  globalG.setDefaultEdgeLabel(() => ({}))

  const clusterNodeMap = new Map<string, LayoutCluster>()
  for (const cluster of clusters) {
    for (const n of cluster.nodes) { clusterNodeMap.set(n.id, cluster) }
    globalG.setNode(cluster.id, {
      width: cluster.bounds!.w,
      height: cluster.bounds!.h,
    })
  }

  const addedEdges = new Set<string>()
  for (const e of edges) {
    const c1 = clusterNodeMap.get(e.source)
    const c2 = clusterNodeMap.get(e.target)
    if (c1 && c2 && c1 !== c2) {
      const key = `${c1.id}→${c2.id}`
      if (!addedEdges.has(key)) {
        globalG.setEdge(c1.id, c2.id)
        addedEdges.add(key)
        logs.push(`  簇间连线: ${c1.id} → ${c2.id}`)
      }
    }
  }

  dagre.layout(globalG)

  for (const cluster of clusters) {
    const dn = globalG.node(cluster.id)
    if (dn) {
      const offsetX = dn.x - cluster.bounds!.w / 2
      const offsetY = dn.y - cluster.bounds!.h / 2
      logs.push(`  簇 ${cluster.id}: 偏移 (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`)
      for (const n of cluster.nodes) {
        n.position = { x: n.position.x + offsetX, y: n.position.y + offsetY }
      }
      cluster.bounds!.x = offsetX
      cluster.bounds!.y = offsetY
    }
  }
}

// ═══════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════

export interface RunLayoutInput {
  nodes: Node[]
  edges: Edge[]
  groups: { id: string; nodeIds: Set<string> }[]
  config: AutoLayoutConfig
}

export interface RunLayoutResult {
  nodes: Node[]
  logs: string[]
}

export function runAutoLayout(input: RunLayoutInput): RunLayoutResult {
  const logs: string[] = []

  logs.push(`方向=${input.config.direction} intra=(${input.config.intraSpacing.x},${input.config.intraSpacing.y}) inter=(${input.config.interSpacing.x},${input.config.interSpacing.y})`)
  logs.push('---')

  // Step 1-2: 分簇 + 合并
  const { clusters, logs: stepLogs } = buildClusters(input.nodes, input.edges, input.groups)
  logs.push(...stepLogs)

  // Step 3: 递归布局
  logs.push('---')
  logs.push('Step 3: 递归布局...')
  for (const cluster of clusters) {
    layoutClusterRecursive(cluster, input.edges, input.config, logs)
  }

  // Step 3.5: 全局簇级布局
  logs.push('---')
  logs.push('Step 3.5: 全局簇级布局 (dagre)')
  layoutGlobalClusters(clusters, input.edges, input.config, logs)

  return { nodes: input.nodes, logs }
}
