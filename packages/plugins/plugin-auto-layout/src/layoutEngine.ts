/**
 * layoutEngine.ts — 嵌套分簇自动布局引擎（v2 复刻老版 canvas-core/auto-layout/layoutEngine）。
 *
 * 算法：
 *  Step 1: 分簇 → 组内节点(簇A) / 连通分量(簇B) / 孤立节点(簇C)
 *  Step 2: 合并 → Union-Find 将跨簇连线关联的簇合并为 Super-Cluster
 *  Step 3: 递归布局 → 子簇内部 dagre → 子簇块级 dagre → 平移子节点
 *  Step 4: 重算 Group bounds → bbox + padding（调用方负责写回 group 节点）
 *
 * 纯函数、零框架依赖（依赖 @dagrejs/dagre），全部可 node 单测。
 * 节点几何用 LayoutNode{id,type,position,size}；引擎直接 mutate 传入 nodes 的 position（绝对坐标输出）。
 */

import dagre from '@dagrejs/dagre'
import type {
  AutoLayoutConfig,
  GroupBounds,
  LayoutCluster,
  LayoutEdge,
  LayoutNode,
} from './types'

const GROUP_PADDING_X = 30
const GROUP_PADDING_Y = 30
const GROUP_PADDING_TOP = 10
const DEFAULT_NODE_W = 200
const DEFAULT_NODE_H = 100

function getNodeDim(node: LayoutNode): { w: number; h: number } {
  return {
    w: node.size?.w ?? DEFAULT_NODE_W,
    h: node.size?.h ?? DEFAULT_NODE_H,
  }
}

/**
 * 把「水平/垂直间距」翻译成 dagre 的 nodesep / ranksep。
 *
 * dagre 这两个参数的**含义随流向翻转**（很容易接反）：
 * - `ranksep` = 相邻「层」（rank）之间的距离 —— 即沿流向那一维；
 * - `nodesep` = 同一层内「节点与节点」之间的距离 —— 即垂直于流向那一维。
 *
 * 于是：
 * - 横向流（LR/RL）：ranksep = 水平间距，nodesep = 垂直间距；
 * - 纵向流（TB/BT）：nodesep = 水平间距，ranksep = 垂直间距。
 *
 * 调用方一律用 { x: 水平, y: 垂直 } 表达，经本函数转换，避免按方向手写而接反。
 */
function toDagreSpacing(
  direction: AutoLayoutConfig['direction'],
  spacing: { x: number; y: number },
): { nodesep: number; ranksep: number } {
  const horizontalFlow = direction === 'LR' || direction === 'RL'
  return horizontalFlow
    ? { nodesep: spacing.y, ranksep: spacing.x }
    : { nodesep: spacing.x, ranksep: spacing.y }
}

export interface ClusterResult {
  clusters: LayoutCluster[]
  logs: string[]
}

export function buildClusters(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  groups: { id: string; nodeIds: Set<string> }[],
): ClusterResult {
  const logs: string[] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const clusters: LayoutCluster[] = []

  // Step 1a: 组内子节点 → 簇A
  const groupedIds = new Set<string>()
  for (const group of groups) {
    const groupNodes: LayoutNode[] = []
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
  const remaining = nodes.filter(n => !groupedIds.has(n.id))

  const adjacency = new Map<string, string[]>()
  for (const n of remaining) { adjacency.set(n.id, []) }
  for (const e of edges) {
    if (adjacency.has(e.source) && adjacency.has(e.target)) {
      adjacency.get(e.source)!.push(e.target)
      adjacency.get(e.target)!.push(e.source)
    }
  }

  const visited = new Set<string>()
  function bfs(startId: string): LayoutNode[] {
    const comp: LayoutNode[] = []
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

/** dagre 内部布局：dagre 输出 center 坐标，这里转为 top-left */
function layoutWithDagre(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  config: AutoLayoutConfig,
): GroupBounds {
  const g = new dagre.graphlib.Graph()
  const intra = toDagreSpacing(config.direction, config.intraSpacing)
  g.setGraph({
    rankdir: config.direction,
    nodesep: intra.nodesep,
    ranksep: intra.ranksep,
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

export function layoutClusterRecursive(
  cluster: LayoutCluster,
  allEdges: LayoutEdge[],
  config: AutoLayoutConfig,
  logs: string[],
): void {
  if (cluster.type === 'single') {
    const dim = getNodeDim(cluster.nodes[0])
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
    for (const sub of cluster.subClusters) {
      layoutClusterRecursive(sub, allEdges, config, logs)
    }

    const subG = new dagre.graphlib.Graph()
    const inter = toDagreSpacing(config.direction, config.interSpacing)
    subG.setGraph({
      rankdir: config.direction,
      nodesep: inter.nodesep,
      ranksep: inter.ranksep,
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

export function layoutGlobalClusters(
  clusters: LayoutCluster[],
  edges: LayoutEdge[],
  config: AutoLayoutConfig,
  logs: string[],
): void {
  if (clusters.length <= 1) {
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
  const inter = toDagreSpacing(config.direction, config.interSpacing)
  globalG.setGraph({
    rankdir: config.direction,
    nodesep: inter.nodesep,
    ranksep: inter.ranksep,
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

export interface RunLayoutInput {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  groups: { id: string; nodeIds: Set<string> }[]
  config: AutoLayoutConfig
}

export interface RunLayoutResult {
  nodes: LayoutNode[]
  logs: string[]
}

export function runAutoLayout(input: RunLayoutInput): RunLayoutResult {
  const logs: string[] = []

  logs.push(`方向=${input.config.direction} intra=(${input.config.intraSpacing.x},${input.config.intraSpacing.y}) inter=(${input.config.interSpacing.x},${input.config.interSpacing.y})`)
  logs.push('---')

  const { clusters, logs: stepLogs } = buildClusters(input.nodes, input.edges, input.groups)
  logs.push(...stepLogs)

  logs.push('---')
  logs.push('Step 3: 递归布局...')
  for (const cluster of clusters) {
    layoutClusterRecursive(cluster, input.edges, input.config, logs)
  }

  logs.push('---')
  logs.push('Step 3.5: 全局簇级布局 (dagre)')
  layoutGlobalClusters(clusters, input.edges, input.config, logs)

  return { nodes: input.nodes, logs }
}
