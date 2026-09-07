/**
 * plugin-clipboard —— 复制/粘贴纯逻辑引擎（与 DOM/内核无耦合，Node 可单测）。
 *
 * 复刻老版 canvas-core/src/plugins/clipboard 的数据逻辑，但只处理"剪贴板快照 + 偏移 + id 重映射"，
 * 不碰 VueFlow/宿主内部。读/写 store 交给 clipboardPlugin 里的 Service，这里全是纯函数：
 * - 边过滤：两端都在选中集(复制带走的内连边) / 任一端触碰选中集(剪切要删的边)；
 * - 粘贴偏移：有鼠标锚点 → 组中心对齐锚点(flow 坐标)；无锚点 → 级联 +20/次；
 * - 快照重映射：为克隆节点生成新 id(含父引用跟随)、按新 id 重连边、整组平移 offset。
 *
 * 快照里节点取 v2 内核最小形状 {id,type,position,data,parentId?,size?}；
 * 边取 {id,source,target,type?,sourceHandle?,targetHandle?}；data 深拷贝(JSON)防共享引用。
 */

/** 剪贴板节点最小形状（v2 CanvasNode 的"可持久化"子集，剥掉 selected/运行时脏字段） */
export interface ClipboardNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  parentId?: string
  size?: { w: number; h: number }
}

/** 剪贴板边最小形状 */
export interface ClipboardEdge {
  id: string
  source: string
  target: string
  type?: string
  sourceHandle?: string
  targetHandle?: string
}

/** 剪贴板快照（一次 copy 的产物；paste 从它克隆） */
export interface ClipboardSnapshot {
  nodes: ClipboardNode[]
  edges: ClipboardEdge[]
  /** 复制时刻（诊断/调试用；不影响行为） */
  copyTime: number
}

/** flow 坐标点（锚点/偏移用） */
export interface ClipboardFlowPoint {
  x: number
  y: number
}

/** 只要形状匹配的边（容忍内核 CanvasEdge / 渲染态窄对象；保留调用方完整类型） */
/** 取"两端都落在选中节点集"的内连边（复制走） */
export function internalEdgesOf<E extends { source: string; target: string }>(
  edges: E[],
  selectedIds: ReadonlySet<string>,
): E[] {
  return edges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target))
}

/** 取"任一端触碰选中节点集"的边（剪切删除/落盘清理走） */
export function touchingEdgesOf<E extends { source: string; target: string }>(
  edges: E[],
  nodeIds: Iterable<string>,
): E[] {
  const ids = new Set(nodeIds)
  return edges.filter((e) => ids.has(e.source) || ids.has(e.target))
}

/** 把节点剥成可持久化最小形状（丢弃 selected 等渲染态字段；data 深拷贝） */
export function toClipboardNodes(nodes: any[]): ClipboardNode[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: deepClone<Record<string, unknown>>(n.data ?? {}),
    ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
    ...(n.size !== undefined ? { size: { w: n.size.w, h: n.size.h } } : {}),
  }))
}

/** 把边剥成可持久化最小形状（输入容忍内核 CanvasEdge / 渲染态窄对象；仅取 id/source/target/handle/type） */
export function toClipboardEdges<E extends { id: string; source: string; target: string; type?: string; sourceHandle?: string; targetHandle?: string }>(
  edges: E[],
): ClipboardEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    ...(e.type !== undefined ? { type: e.type } : {}),
    ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
  }))
}

/** 建一份剪贴板快照（节点/边已剥干净 + 深拷贝） */
export function makeSnapshot(nodes: ClipboardNode[], edges: ClipboardEdge[], copyTime = Date.now()): ClipboardSnapshot {
  return { nodes: toClipboardNodes(nodes), edges: toClipboardEdges(edges), copyTime }
}

/**
 * 计算粘贴偏移（对齐老版语义）：
 * - 节点组中心 = 选中集包围盒中心（尺寸：size 字段优先，缺省 256x256，与老版 dimensions 兜底一致）；
 * - 有鼠标锚点(flow 坐标)：offset = 锚点 - 组中心（组中心对准鼠标）；
 * - 无锚点：级联偏移 50 + pasteCount*20（多次粘贴递增，避免叠在一起）。
 * 空快照兜底返回 {x:50,y:50}。
 */
export function computePasteOffset(
  nodes: Array<{ position: { x: number; y: number }; size?: { w: number; h: number } }>,
  anchor?: ClipboardFlowPoint | null,
  pasteCount = 0,
): { offsetX: number; offsetY: number } {
  if (nodes.length === 0) return { offsetX: 50, offsetY: 50 }
  const FALLBACK_W = 256
  const FALLBACK_H = 256
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    const w = n.size?.w ?? FALLBACK_W
    const h = n.size?.h ?? FALLBACK_H
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + w)
    maxY = Math.max(maxY, n.position.y + h)
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  if (anchor) return { offsetX: anchor.x - centerX, offsetY: anchor.y - centerY }
  return { offsetX: 50 + pasteCount * 20, offsetY: 50 + pasteCount * 20 }
}

/**
 * id 生成器默认实现（老版同款：oldId-copy-时间戳-随机；保证不与内核数字短 id 撞车）。
 */
export function defaultIdGenerator(oldId: string): string {
  return `${oldId}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 快照 → 粘贴内容（克隆 + 重映射 + 平移）：
 * - 每个节点新 id = genId(oldId)（缺省 defaultIdGenerator），old→new 记入 idMap；
 * - 节点 position 整体 + offset；data 深拷贝（剪贴板快照已剥干净，直接引用快照 data 即可，不共享画布节点）；
 * - 父节点在同批选中集内 → parentId 跟随重映射；父不在批内 → 剥离 parentId(防悬挂引用)；
 * - 边按 idMap 重连 source/target；映射不到任一端则丢弃(理论不发生，防御)。
 */
export function remapSnapshot(
  snapshot: ClipboardSnapshot,
  offset: { offsetX: number; offsetY: number },
  genId: (oldId: string) => string = defaultIdGenerator,
): { nodes: ClipboardNode[]; edges: ClipboardEdge[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>()
  // 先全量建 old→new 映射（父/子谁先谁后都安全：父引用查找不依赖数组序）
  for (const n of snapshot.nodes) idMap.set(n.id, genId(n.id))
  const nodes = snapshot.nodes.map((n) => {
    const newId = idMap.get(n.id)!
    // 显式重建（不 spread n）：只带持久化字段；父在同批才带新 parentId，否则剥离防悬挂
    const node: ClipboardNode = {
      id: newId,
      type: n.type,
      position: { x: n.position.x + offset.offsetX, y: n.position.y + offset.offsetY },
      data: n.data,
      ...(n.size !== undefined ? { size: { w: n.size.w, h: n.size.h } } : {}),
    }
    if (n.parentId !== undefined && idMap.has(n.parentId)) {
      node.parentId = idMap.get(n.parentId)
    }
    return node
  })
  const edges: ClipboardEdge[] = []
  for (const e of snapshot.edges) {
    const ns = idMap.get(e.source)
    const nt = idMap.get(e.target)
    if (!ns || !nt) continue
    edges.push({
      id: e.id, // 占位：真正落盘时 edgeStore 会按 source/target 生成稳定 id（见 clipboardPlugin）
      source: ns,
      target: nt,
      ...(e.type !== undefined ? { type: e.type } : {}),
      ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
      ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
    })
  }
  return { nodes, edges, idMap }
}

/** JSON 深拷贝（快照/节点 data 与历史同款；可序列化数据才安全——节点 data 本就是可持久化形状） */
export function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}
