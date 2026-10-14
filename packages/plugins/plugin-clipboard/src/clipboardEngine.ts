/**
 * plugin-clipboard —— 复制/粘贴纯逻辑引擎（与 DOM/内核无耦合，Node 可单测）。
 *
 * 复刻老版 canvas-core/src/plugins/clipboard 的数据逻辑，但只处理"剪贴板快照 + 偏移 + id 重映射"，
 * 不碰 VueFlow/宿主内部。读/写 store 交给 clipboardPlugin 里的 Service，这里全是纯函数：
 * - 边过滤：两端都在选中集(复制带走的内连边) / 任一端触碰选中集(剪切要删的边)；
 * - 粘贴偏移：有鼠标锚点 → 组中心对齐锚点(flow 坐标)；无锚点 → 级联 +20/次；
 * - 快照重映射：为克隆节点生成新 id(含父引用跟随)、按新 id 重连边、整组平移 offset。
 *
 * 快照里节点取 v2 内核最小形状 + 绝对坐标 {id,type,position,absPosition,data,parentId?,size?}；
 * 边取 {id,source,target,type?,sourceHandle?,targetHandle?}；data 深拷贝(JSON)防共享引用。
 *
 * **坐标语义（本轮修复重点）**：子节点 position 相对父、顶层节点 position 绝对（两套坐标系）。
 * 快照额外记录复制时刻的绝对坐标 absPosition，粘贴偏移一律基于绝对坐标；有父的节点相对坐标不变。
 */

/** 剪贴板节点最小形状（v2 CanvasNode 的"可持久化"子集，剥掉 selected/运行时脏字段） */
export interface ClipboardNode {
  id: string
  type: string
  /**
   * 节点坐标，语义随 parentId 走（与画布一致）：
   * - 有 parentId（父也在本快照里）-> 相对父的局部坐标；
   * - 无 parentId -> flow 绝对坐标。
   */
  position: { x: number; y: number }
  /**
   * 复制时刻的 flow 绝对坐标（父链逐级累加）。
   *
   * 为什么快照要另存它：父与子的 position 是**两套坐标系**（子相对父、顶层绝对），
   * 只拿原始 position 一起算包围盒/加偏移就是把两块坐标混着算 —— 带分组的复制粘贴整块错位、
   * 子节点在分组里四散（用户 2026-10-09 报的就是这个）。绝对坐标才是"整块刚性平移"的基准。
   */
  absPosition: { x: number; y: number }
  data: Record<string, unknown>
  /** 父节点 id —— 仅当该父也在本快照里时才保留（父在批外时按绝对坐标落顶层，防悬挂引用） */
  parentId?: string
  size?: { w: number; h: number }
}

/** toClipboardNodes 的输入：可持久化节点（position 可能是相对父的局部值） */
export interface ClipboardNodeInput {
  id: string
  type: string
  position: { x: number; y: number }
  data?: Record<string, unknown>
  parentId?: string
  size?: { w: number; h: number }
}

/** 复制时取节点绝对坐标的注入口（用整张画布的父链，能算到"父未被选中"的子节点） */
export type ClipboardAbsProvider = (id: string) => { x: number; y: number } | undefined

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

/** 快照节点里 data.label 是否算"有名字"：非空字符串才算（空串/缺键 = 没名字，粘贴时补默认名） */
function hasLabel(data: Record<string, unknown> | undefined): boolean {
  const label = data?.label
  return typeof label === 'string' && label.trim().length > 0
}

/**
 * 给**克隆出来**的节点改默认名。
 *
 * 为什么要这一步：节点默认名（"文本 3"）只在**建节点那一刻**由数据层按类型模板生成
 * （nodeStore.nextDefaultName），而粘贴走的是 addNodes + 显式 data —— 显式的 label 会原样保留
 * （那是刻意的：不能把用户改过的标题冲掉）。于是"复制一个「文本 1」粘贴"会得到第二个
 * 「文本 1」，两个节点同名分不清（用户 2026-10-12 报的第二条缺陷）。
 *
 * 做法：只给**带名字**的克隆节点重新取号（走注入的 nameProvider = doc.nextTypeName，
 * 与新建节点同一份按类型计数，所以"文本 1/2/3"是一条连续的号，不会撞号）。
 * 本来就没名字的节点（label 空/缺）保持原样 —— 数据层 addNodes 会自动按模板补默认名，
 * 这里再给一个反而会多跳一个号。
 *
 * @param nameProvider 取"该类型下一个默认名"的注入口（宿主给 doc.nextTypeName）。
 *   缺省 = 不改名（单测/极简宿主不需服务也能跑）。
 */
export function renameClonedNodes(
  nodes: ClipboardNode[],
  nameProvider?: (type: string) => string,
): ClipboardNode[] {
  if (!nameProvider) return nodes
  return nodes.map((n) => {
    if (!hasLabel(n.data)) return n
    return { ...n, data: { ...n.data, label: nameProvider(n.type) } }
  })
}

/**
 * 校验"从系统剪贴板读回来的快照"（跨窗口粘贴的唯一入口，数据来自外部，必须当不可信输入处理）。
 *
 * 判据只有"形状对不对"：节点要有 string 的 id/type、position 有两个有限数；边要有 id/source/target。
 * 不合法的一律丢弃（**不是**抛错）—— 剪贴板里可能是别的应用塞的 JSON，画布不该因此炸掉。
 * parentId 仍按"父也在本批里"收敛（与 toClipboardNodes 同一条不变量：父在批外就落顶层，防悬挂）。
 */
export function coerceClipboardSnapshot(
  raw: { nodes: readonly unknown[]; edges: readonly unknown[] },
  copyTime?: number,
): ClipboardSnapshot {
  const nodes: ClipboardNode[] = []
  const seen = new Set<string>()
  for (const item of raw.nodes) {
    const n = item as Partial<ClipboardNode> | null
    if (!n || typeof n !== 'object') continue
    if (typeof n.id !== 'string' || typeof n.type !== 'string') continue
    if (seen.has(n.id)) continue
    const position = coercePoint(n.position)
    if (!position) continue
    seen.add(n.id)
    const absPosition = coercePoint(n.absPosition) ?? position
    nodes.push({
      id: n.id,
      type: n.type,
      position,
      absPosition,
      // data 来自外部：深拷贝 + 只认普通对象（数组/字符串当空 data 处理）
      data: n.data && typeof n.data === 'object' && !Array.isArray(n.data)
        ? deepClone(n.data as Record<string, unknown>)
        : {},
      ...(typeof n.parentId === 'string' ? { parentId: n.parentId } : {}),
      ...(coerceSize(n.size) ? { size: coerceSize(n.size)! } : {}),
    })
  }
  // 父在批外 → 剥离 parentId，并把 position 重定基到绝对坐标（与 toClipboardNodes 同一口径）
  for (const n of nodes) {
    if (n.parentId !== undefined && !seen.has(n.parentId)) {
      delete n.parentId
      n.position = { x: n.absPosition.x, y: n.absPosition.y }
    }
  }
  const edges: ClipboardEdge[] = []
  for (const item of raw.edges) {
    const e = item as Partial<ClipboardEdge> | null
    if (!e || typeof e !== 'object') continue
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') continue
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(typeof e.type === 'string' ? { type: e.type } : {}),
      ...(typeof e.sourceHandle === 'string' ? { sourceHandle: e.sourceHandle } : {}),
      ...(typeof e.targetHandle === 'string' ? { targetHandle: e.targetHandle } : {}),
    })
  }
  return { nodes, edges, copyTime: copyTime ?? Date.now() }
}

/** 坐标点校验（两个有限数才算） */
function coercePoint(value: unknown): { x: number; y: number } | undefined {
  const p = value as { x?: unknown; y?: unknown } | null
  if (!p || typeof p !== 'object') return undefined
  return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y)
    ? { x: p.x, y: p.y }
    : undefined
}

/** 尺寸校验（两个正有限数才算） */
function coerceSize(value: unknown): { w: number; h: number } | undefined {
  const s = value as { w?: unknown; h?: unknown } | null
  if (!s || typeof s !== 'object') return undefined
  return typeof s.w === 'number' && Number.isFinite(s.w) && s.w > 0 &&
    typeof s.h === 'number' && Number.isFinite(s.h) && s.h > 0
    ? { w: s.w, h: s.h }
    : undefined
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

/**
 * 把节点剥成可持久化最小形状（丢弃 selected 等渲染态字段；data 深拷贝），
 * 并补上"复制时刻的绝对坐标" `absPosition`。
 *
 * 为什么必须在这里算绝对坐标：带 parentId 的节点 position 是**相对父的局部坐标**，
 * 与顶层节点的绝对坐标是两套体系。粘贴偏移只能基于绝对坐标（整块刚性平移）——
 * 直接混算原始 position 会让带分组的复制粘贴整块错位、子节点四散。
 *
 * 父链解析规则（快照只带被复制的节点，父可能不在批内）：
 * - 父**在批内** → 沿批内父链累加（父的 position 相对它自己的父，正是需要的量）；
 * - 父**不在批内**（复制时父未被选中）→ 批内父链断在父那里，改问注入的 `absProvider`
 *   （宿主用整张画布的 parentId 链算绝对坐标，能算到任意深）；`absProvider` 缺席时
 *   退化为"把自身 position 当绝对坐标"（顶层节点本就如此）。
 *
 * 同时把 parentId 收敛到"父也在快照里"：父在批外 → 不写 parentId（粘贴后按绝对坐标落顶层，防悬挂）。
 */
export function toClipboardNodes(nodes: ClipboardNodeInput[], absProvider?: ClipboardAbsProvider): ClipboardNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))

  /** 某节点的绝对坐标：批内能解析的部分用批内累加，断在批外则交给 absProvider */
  const resolveAbs = (node: ClipboardNodeInput): { x: number; y: number } => {
    let x = node.position?.x ?? 0
    let y = node.position?.y ?? 0
    let cur: ClipboardNodeInput | undefined = node
    const seen = new Set<string>([node.id])
    while (cur?.parentId !== undefined) {
      if (seen.has(cur.parentId)) break // 环保护
      seen.add(cur.parentId)
      const parent = byId.get(cur.parentId)
      if (!parent) {
        // 父在批外：批内父链到此为止，改用整张画布的绝对坐标（拿不到就保持当前累加值）
        const outer = absProvider?.(node.id)
        if (outer) {
          x = outer.x
          y = outer.y
        }
        break
      }
      x += parent.position?.x ?? 0
      y += parent.position?.y ?? 0
      cur = parent
    }
    return { x, y }
  }

  return nodes.map((n) => {
    const abs = resolveAbs(n)
    // 父在快照里才带 parentId；父在批外 → 剥离（粘贴时按绝对坐标落顶层）
    const parentInBatch = n.parentId !== undefined && byId.has(n.parentId)
    return {
      id: n.id,
      type: n.type,
      // 保持"position 语义随 parentId 走"这条不变量：
      // 父在批内 → 保留相对坐标；父被剥离 → 把 position 重定基到绝对坐标（否则粘贴会把局部值当绝对用）
      position: parentInBatch
        ? { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }
        : { x: abs.x, y: abs.y },
      absPosition: abs,
      data: deepClone<Record<string, unknown>>(n.data ?? {}),
      ...(parentInBatch ? { parentId: n.parentId } : {}),
      ...(n.size !== undefined ? { size: { w: n.size.w, h: n.size.h } } : {}),
    }
  })
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

/** 建一份剪贴板快照（节点/边已剥干净 + 深拷贝 + 绝对坐标） */
export function makeSnapshot(
  nodes: ClipboardNodeInput[],
  edges: ClipboardEdge[],
  copyTime = Date.now(),
  absProvider?: ClipboardAbsProvider,
): ClipboardSnapshot {
  return { nodes: toClipboardNodes(nodes, absProvider), edges: toClipboardEdges(edges), copyTime }
}

/**
 * 计算粘贴偏移（对齐老版语义）：
 * - 节点组中心 = 选中集包围盒中心（尺寸：size 字段优先，缺省 256x256，与老版 dimensions 兜底一致）；
 * - 有鼠标锚点(flow 坐标)：offset = 锚点 - 组中心（组中心对准鼠标）；
 * - 无锚点：级联偏移 50 + pasteCount*20（多次粘贴递增，避免叠在一起）。
 * 空快照兜底返回 {x:50,y:50}。
 */
export function computePasteOffset(
  nodes: Array<{ absPosition: { x: number; y: number }; size?: { w: number; h: number }; parentId?: string }>,
  anchor?: ClipboardFlowPoint | null,
  pasteCount = 0,
): { offsetX: number; offsetY: number } {
  if (nodes.length === 0) return { offsetX: 50, offsetY: 50 }
  const FALLBACK_W = 256
  const FALLBACK_H = 256
  // 包围盒只取"根"节点（无父）：子节点在几何上位于根容器内部，根矩形已覆盖整块内容。
  // 把子节点也算进去反而会偏 —— 子节点常没有声明尺寸，256 兜底会把包围盒撑到容器外面，
  // 中心随之偏移（分组复制粘贴时会看出"贴不到鼠标"）。
  const roots = nodes.filter((n) => n.parentId === undefined)
  const boxed = roots.length > 0 ? roots : nodes
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of boxed) {
    const w = n.size?.w ?? FALLBACK_W
    const h = n.size?.h ?? FALLBACK_H
    // 用**绝对坐标**算包围盒：子节点 position 是相对父的局部值，混着算中心就错了（见 absPosition 说明）
    minX = Math.min(minX, n.absPosition.x)
    minY = Math.min(minY, n.absPosition.y)
    maxX = Math.max(maxX, n.absPosition.x + w)
    maxY = Math.max(maxY, n.absPosition.y + h)
  }
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  if (anchor) return { offsetX: anchor.x - centerX, offsetY: anchor.y - centerY }
  return { offsetX: 50 + pasteCount * 20, offsetY: 50 + pasteCount * 20 }
}

/**
 * 快照 → 粘贴内容（克隆 + 重映射 + 平移）：
 * - 每个节点新 id = genId(oldId)，old→new 记入 idMap；
 * - **平移按绝对坐标做**：
 *   · 有父（父也在本批里）→ `position` 是相对父的局部坐标，**整块刚性平移时不变**，
 *     父节点自己平移即可带着子树一起走（这正是父子关系不丢的关键）；
 *   · 无父（顶层）→ `position` 是绝对坐标，加上 offset；
 *   · 快照里 `parentId` 已收敛为"父也在批内"（见 toClipboardNodes），故不在此再判悬挂；
 * - data 深拷贝（快照已剥干净，直接引用快照 data 即可，不共享画布节点）；
 * - 边按 idMap 重连 source/target；映射不到任一端则丢弃(理论不发生，防御)。
 */
export function remapSnapshot(
  snapshot: ClipboardSnapshot,
  offset: { offsetX: number; offsetY: number },
  /** 新 id 生成器。**必须由调用方注入** —— 统一走内核 `doc.nextNodeId()`（自增数字），
   *  本层不再提供"自造 id"的默认实现：那正是画布里 id 形态五花八门的来源。 */
  genId: (oldId: string) => string,
): { nodes: ClipboardNode[]; edges: ClipboardEdge[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>()
  // 先全量建 old→new 映射（父/子谁先谁后都安全：父引用查找不依赖数组序）
  for (const n of snapshot.nodes) idMap.set(n.id, genId(n.id))
  const nodes = snapshot.nodes.map((n) => {
    const newId = idMap.get(n.id)!
    const parentId = n.parentId
    const mappedParentId = parentId !== undefined ? idMap.get(parentId) : undefined
    const hasParent = mappedParentId !== undefined
    // 显式重建（不 spread n）：只带持久化字段
    const node: ClipboardNode = {
      id: newId,
      type: n.type,
      // 有父 → 相对坐标原样保留（随父整体平移）；无父 → 绝对坐标加偏移
      position: hasParent
        ? { x: n.position.x, y: n.position.y }
        : { x: n.position.x + offset.offsetX, y: n.position.y + offset.offsetY },
      // 绝对坐标仅供诊断/下游参考，给平移后的值
      absPosition: { x: n.absPosition.x + offset.offsetX, y: n.absPosition.y + offset.offsetY },
      data: n.data,
      ...(n.size !== undefined ? { size: { w: n.size.w, h: n.size.h } } : {}),
    }
    if (hasParent) node.parentId = mappedParentId
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
