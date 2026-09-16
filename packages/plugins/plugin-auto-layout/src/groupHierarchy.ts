/**
 * groupHierarchy —— 组层级递归布局（纯逻辑，dagre + 可单测）。
 *
 * 用户拍板的语义：
 * - 主节点（组）在**它所在的层**被识别为一个节点（占位）参与布局；
 * - 组内部的节点又识别成一张"子画布"独立布局；
 * - 平铺节点数组先转成树（支持组嵌套组），从嵌套最深的组开始布局；
 * - 每个组内部布局完成后重算该组 rect（frame = 直接子节点新包围盒 + padding），
 *   然后该组作为占位节点参与其上层布局，逐层向上直到完成。
 *
 * 坐标约定：
 * - 输入节点 position 为绝对坐标（调用方负责把组内相对坐标累加父链）；
 * - 输出 positions：组内子节点为**相对父组左上**的坐标（直接可写回 nodeStore）；
 *   顶层节点为绝对坐标。groupFrames：组节点的最终 frame（绝对坐标 + 尺寸）。
 */
import dagre from '@dagrejs/dagre'
import type { AutoLayoutConfig, GroupBounds, LayoutEdge, LayoutNode } from './types'

/** 组默认 padding（四周 30、顶部 40 给标题条 —— 与 plugin-group 默认一致，需同步修改） */
const PAD = { left: 30, right: 30, top: 40, bottom: 30 }
const MIN_GROUP_W = 200
const MIN_GROUP_H = 150
const DEFAULT_NODE_W = 200
const DEFAULT_NODE_H = 100

function nodeDim(n: LayoutNode): { w: number; h: number } {
  return { w: n.size?.w ?? DEFAULT_NODE_W, h: n.size?.h ?? DEFAULT_NODE_H }
}

/** 树节点：组节点（isGroup）带 children；叶子 = 普通节点 */
export interface GroupTreeNode {
  id: string
  isGroup: boolean
  depth: number
  /** 组节点自身的 LayoutNode（占位尺寸用当前 frame）；叶子 = 普通节点 LayoutNode */
  node: LayoutNode
  children: GroupTreeNode[]
}

export interface GroupTree {
  roots: GroupTreeNode[]
  /** groupId → 树节点 */
  groups: Map<string, GroupTreeNode>
}

/**
 * 平铺节点数组 → 树（支持组嵌套组）。
 * 组节点判定：type === 'group'（与 plugin-group / autoLayoutPlugin 同约定）。
 * parentId 指向不存在节点的孤儿按顶层处理（防悬挂）。
 */
export function buildGroupTree(nodes: LayoutNode[]): GroupTree {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const groups = new Map<string, GroupTreeNode>()
  const leaves = new Map<string, GroupTreeNode>()
  const makeNode = (n: LayoutNode, depth: number): GroupTreeNode => ({
    id: n.id,
    isGroup: n.type === 'group',
    depth,
    node: n,
    children: [],
  })
  // 两遍：先建所有树节点，再连父子（组可能嵌套组）
  for (const n of nodes) {
    const t = makeNode(n, 0)
    if (t.isGroup) groups.set(n.id, t)
    else leaves.set(n.id, t)
  }
  const all = new Map<string, GroupTreeNode>([...groups, ...leaves])
  const roots: GroupTreeNode[] = []
  for (const n of nodes) {
    const t = all.get(n.id)!
    const pid = n.parentId
    const parent = pid ? byId.get(pid) : undefined
    // 父存在且（父是组 或 父是任意节点——非组父属非常规数据，按顶层处理防错位）
    if (pid && parent && parent.type === 'group' && all.has(pid)) {
      const pt = groups.get(pid)!
      t.depth = pt.depth + 1
      pt.children.push(t)
    } else {
      roots.push(t)
    }
  }
  // depth 递归修正（build 时 depth 未按链路更新）
  const fixDepth = (t: GroupTreeNode, d: number): void => {
    t.depth = d
    for (const c of t.children) fixDepth(c, d + 1)
  }
  for (const r of roots) fixDepth(r, 0)
  return { roots, groups }
}

function frameOf(children: Array<{ x: number; y: number; w: number; h: number }>): GroupBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of children) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + c.w)
    maxY = Math.max(maxY, c.y + c.h)
  }
  const w = Math.max(maxX - minX + PAD.left + PAD.right, MIN_GROUP_W)
  const h = Math.max(maxY - minY + PAD.top + PAD.bottom, MIN_GROUP_H)
  return { x: minX - PAD.left, y: minY - PAD.top, w, h }
}

function toDagreSpacing(direction: AutoLayoutConfig['direction'], spacing: { x: number; y: number }) {
  const horizontal = direction === 'LR' || direction === 'RL'
  return horizontal
    ? { nodesep: spacing.y, ranksep: spacing.x }
    : { nodesep: spacing.x, ranksep: spacing.y }
}

/** 对一组占位节点跑 dagre，返回 id → 中心点 */
function dagrePlace(
  items: Array<{ id: string; w: number; h: number }>,
  edges: Array<{ source: string; target: string }>,
  direction: AutoLayoutConfig['direction'],
  spacing: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  const sp = toDagreSpacing(direction, spacing)
  g.setGraph({ rankdir: direction, nodesep: sp.nodesep, ranksep: sp.ranksep, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const it of items) g.setNode(it.id, { width: it.w, height: it.h })
  const ids = new Set(items.map((i) => i.id))
  const seen = new Set<string>()
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    const key = e.source + '→' + e.target
    if (seen.has(key)) continue
    seen.add(key)
    g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  const out = new Map<string, { x: number; y: number }>()
  for (const it of items) {
    const dn = g.node(it.id)
    if (dn) out.set(it.id, { x: dn.x, y: dn.y })
  }
  return out
}

export interface HierarchyLayoutResult {
  /** 全部普通节点（含组内子节点）最终 position：顶层=绝对，组内=相对父组 */
  positions: Map<string, { x: number; y: number }>
  /** 组节点最终 frame（绝对坐标）：写回 group 节点的 position/size */
  groupFrames: Map<string, GroupBounds>
  logs: string[]
}

/**
 * 层级递归布局主入口。
 * @param nodes 全部非 group 节点 + 全部组节点（position = 绝对坐标）
 * @param edges 全部边（绝对语义；组内→组外/跨组的边在占位层提升使用）
 */
export function layoutHierarchy(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  config: AutoLayoutConfig,
): HierarchyLayoutResult {
  const tree = buildGroupTree(nodes)
  const logs: string[] = []
  const positions = new Map<string, { x: number; y: number }>()
  const groupFrames = new Map<string, GroupBounds>()
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  /** 组 → 直接子节点（树） */

  /**
   * 布局一个组子树（深度优先：先内层组，再本组直接子节点 dagre，最后算本组 frame）。
   * 返回本组 frame（绝对坐标），并把组内子节点的最终相对坐标写入 positions。
   */
  function layoutGroupSubtree(t: GroupTreeNode): GroupBounds {
    // 1) 先递归：内层嵌套组先完成（各自得到 frame）
    const nestedGroups = t.children.filter((c) => c.isGroup)
    const nestedFrames = new Map<string, GroupBounds>()
    for (const sub of nestedGroups) {
      nestedFrames.set(sub.id, layoutGroupSubtree(sub))
    }
    // 2) 本组直接子节点（普通叶子 + 已定 frame 的嵌套组占位）做 dagre
    const directLeaves = t.children.filter((c) => !c.isGroup)
    const items: Array<{ id: string; w: number; h: number }> = []
    const dims = new Map<string, { w: number; h: number }>()
    for (const c of directLeaves) {
      const d = nodeDim(c.node)
      dims.set(c.id, d)
      items.push({ id: c.id, w: d.w, h: d.h })
    }
    for (const sub of nestedGroups) {
      const f = nestedFrames.get(sub.id)!
      dims.set(sub.id, { w: f.w, h: f.h })
      items.push({ id: sub.id, w: f.w, h: f.h })
    }
    // 本组内部的边（两端都是直接子节点）参与 dagre
    const childIds = new Set(t.children.map((c) => c.id))
    const internalEdges = edges.filter((e) => childIds.has(e.source) && childIds.has(e.target))
    const centers = dagrePlace(items, internalEdges, config.direction, config.intraSpacing)
    // 3) 组 frame = 子节点新包围盒 + padding（dagre 中心 → 左上）
    const placed = items.map((it) => {
      const c = centers.get(it.id)!
      const d = dims.get(it.id)!
      return { id: it.id, x: c.x - d.w / 2, y: c.y - d.h / 2, w: d.w, h: d.h }
    })
    const frame = frameOf(placed)
    groupFrames.set(t.id, frame)
    // 4) 写子节点坐标：
    //    - 普通叶子：相对组 frame 左上（写回 nodeStore 的组内相对坐标）
    //    - 嵌套子组：frame 平移（frame.x/y += 组 frame 左上），子树内已写的相对坐标不变
    //      （嵌套组的 frame 是递归生成的"局部 frame"，其内部坐标均相对它 → 只需整体平移 frame）
    for (const it of placed) {
      const subFrame = nestedFrames.get(it.id)
      if (subFrame) {
        subFrame.x += frame.x
        subFrame.y += frame.y
        // 嵌套组的内部子节点相对坐标已在递归中写好（相对 subFrame 局部原点），无需改
      } else {
        positions.set(it.id, { x: it.x - frame.x, y: it.y - frame.y })
      }
    }
    logs.push(`[group ${t.id}] frame=(${frame.x.toFixed(0)},${frame.y.toFixed(0)}) ${frame.w.toFixed(0)}x${frame.h.toFixed(0)}`)
    return frame
  }

  // ═══ 自底向上：深度最深组的子树先完成（buildGroupTree 已按根建好，递归天然自底向上）═══
  /** 顶层占位项：顶层自由节点 + 顶层组（frame 已在递归中生成） */
  const topItems: Array<{ id: string; w: number; h: number; isGroup: boolean }> = []
  const topLeafIds = new Set<string>()
  // 先递归所有顶层组（含其整棵子树）
  for (const r of tree.roots) {
    if (r.isGroup) {
      const f = layoutGroupSubtree(r)
      topItems.push({ id: r.id, w: f.w, h: f.h, isGroup: true })
    } else {
      topLeafIds.add(r.id)
    }
  }
  // 顶层自由节点（连接分量/孤立节点由 dagre 统一排）
  for (const id of topLeafIds) {
    const d = nodeDim(nodeById.get(id)!)
    topItems.push({ id, w: d.w, h: d.h, isGroup: false })
  }
  // 顶层边：两端都在顶层自由节点间；组占位的边 = 组内任一节点 ↔ 外部节点（提升为组 ↔ 外部）
  const topIds = new Set(topItems.map((i) => i.id))
  const topEdges: Array<{ source: string; target: string }> = []
  const seen = new Set<string>()
  // 组 id → 组的树节点（用于把跨组边端点提升到组占位）
  const ancestorGroupOf = new Map<string, string>()
  for (const [gid, gt] of tree.groups) {
    for (const c of gt.children) {
      ancestorGroupOf.set(c.id, gid)
    }
  }
  const topmostOwner = (id: string): string => {
    // 沿父链上溯到最顶层组（若节点在某顶层组的子树里）
    let cur = nodeById.get(id)
    const chain: string[] = []
    while (cur?.parentId) {
      chain.push(cur.parentId)
      cur = nodeById.get(cur.parentId)
    }
    // 链上第一个（最靠近根的）组 = 顶层组
    for (const gid of chain) {
      if (tree.groups.has(gid) && tree.roots.some((r) => r.id === gid)) return gid
    }
    return id
  }
  for (const e of edges) {
    const s = topmostOwner(e.source)
    const t = topmostOwner(e.target)
    if (s === t) continue // 同占位内部的边不参与顶层排布
    if (!topIds.has(s) || !topIds.has(t)) continue
    const key = s + '→' + t
    if (seen.has(key)) continue
    seen.add(key)
    topEdges.push({ source: s, target: t })
  }
  const centers = dagrePlace(
    topItems.map((i) => ({ id: i.id, w: i.w, h: i.h })),
    topEdges,
    config.direction,
    // 顶层间距：画布上有组占位 → 组/簇间用 interSpacing；纯自由节点（无组）→ 用 intraSpacing
    // （对齐旧版行为：无组时两个节点的距离由"组内间距"决定，设置面板改 intraSpacingX 才会疏开）
    topItems.some((i) => i.isGroup) ? config.interSpacing : config.intraSpacing,
  )
  // 顶层写回：自由节点 = 绝对坐标；组 = 平移整棵子树（frame/子树相对坐标已在递归中定 → 平移 frame 即可，
  // 但子树内部"相对坐标"写的是相对 frame —— frame 平移后相对坐标不变 ✓；记录组最终 frame）
  for (const it of topItems) {
    const c = centers.get(it.id)
    if (!c) continue
    if (it.isGroup) {
      const f = groupFrames.get(it.id)!
      const dx = c.x - it.w / 2 - f.x
      const dy = c.y - it.h / 2 - f.y
      f.x += dx
      f.y += dy
      // 子树内嵌套组 frame 也要跟着平移 —— 递归里 frame 已含绝对位置，需按 dx/dy 平移整棵子树
      shiftSubtree(tree.groups.get(it.id)!, dx, dy, groupFrames, positions)
    } else {
      positions.set(it.id, { x: c.x - it.w / 2, y: c.y - it.h / 2 })
    }
  }
  return { positions, groupFrames, logs }
}

/** 把某组子树内所有嵌套组 frame 平移 dx/dy（普通叶子坐标是相对父组的，无需动） */
function shiftSubtree(
  t: GroupTreeNode,
  dx: number,
  dy: number,
  groupFrames: Map<string, GroupBounds>,
  _positions: Map<string, { x: number; y: number }>,
): void {
  for (const c of t.children) {
    if (c.isGroup) {
      const f = groupFrames.get(c.id)
      if (f) {
        f.x += dx
        f.y += dy
      }
      shiftSubtree(c, dx, dy, groupFrames, _positions)
    }
  }
}
