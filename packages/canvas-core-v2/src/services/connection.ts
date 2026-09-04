/**
 * connection —— v2 连接内核（M5 加固：把 v1 useCanvasConnection + ConnectionValidator 的严格校验
 * **原样吸收**，不许改坏）。纯逻辑、零 Vue、可 Node 单测。
 *
 * 吸收的 v1 规则（见 docs/adr/0001 行动项 3 + api.md §七）：
 * - normalizeConnection：缺 handle 归一成 'source'/'target'
 * - toCanonicalConnection：只允许 source→target 或 target→source(反向自动翻正)，其它朝向非法
 * - wouldCreateCycle：DFS 环检测（忽略 isTemp 边）
 * - 重复边检测（同一条 canonical 连接只允许一条，忽略 isTemp）
 * - 声明式 inputs/accepts/limit（api.md §四）：target 的 inputs[].accepts 限定能接哪些源类型；
 *   limit:'single' 限定某输入端口只接一条
 *
 * 注意：canonical 语义 = 输出端 handle 'source' 在 source 节点、输入端 handle 'target' 在 target 节点。
 */

/** 一条待校验/新建的连接（与 VueFlow Connection 同构） */
export interface ConnectionInput {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
}

/** 已存在的边（v2 尚无 edge store，以最小形状传入即可比较） */
export interface ExistingEdge {
  source: string
  sourceHandle?: string | null
  target: string
  targetHandle?: string | null
  data?: { isTemp?: boolean }
}

/** 规范化后的连接（两端 handle 已归一，非空） */
export interface NormalizedConnection {
  source: string
  sourceHandle: string
  target: string
  targetHandle: string
}

/** canonical 端点对（source=输出端、target=输入端） */
export interface CanonicalEndpoints {
  source: string
  target: string
}

/** 声明式端口约束（api.md §四 inputs/outputs） */
export interface PortDef {
  /** 'target'(输入) / 'source'(输出) */
  port?: string
  /** 该端口接受的源节点类型列表；缺省/空 = 来者不拒 */
  accepts?: string[]
  /** 'single' = 该端口只允许一条连接；缺省 = 多条 */
  limit?: 'single' | 'multi'
}

/** 节点类型的连接声明（映射自 nodeStore 类型定义里可选的 inputs/outputs） */
export interface NodeConnectionDef {
  inputs?: PortDef[]
  outputs?: PortDef[]
}

/** 校验上下文：节点表 + 已有边 + 类型定义查询 */
export interface ValidateContext {
  /** 当前存在的节点（id → type） */
  nodes: Map<string, { id: string; type: string }>
  /** 已存在边（含 isTemp 标记） */
  edges: ExistingEdge[]
  /** 由 nodeStore.types 反查某 type 的连接声明 */
  getTypeConn: (type: string) => NodeConnectionDef | undefined
}

export type InvalidReason =
  | 'missing-node'
  | 'self-loop'
  | 'bad-orientation'
  | 'no-source-port'
  | 'no-target-port'
  | 'type-not-accepted'
  | 'limit-reached'
  | 'duplicate'
  | 'cycle'

export interface ValidationResult {
  ok: boolean
  reason: InvalidReason | 'ok'
  /** 通过时给规范化 canonical 端点（供建边） */
  canonical?: CanonicalEndpoints
}

// ============================================================================
// 纯函数（v1 原样吸收，独立可测）
// ============================================================================

/** 规范化：缺 handle 归一成 'source'/'target' */
export function normalizeConnection(c: ConnectionInput): NormalizedConnection {
  return {
    source: c.source,
    sourceHandle: c.sourceHandle || 'source',
    target: c.target,
    targetHandle: c.targetHandle || 'target',
  }
}

/** 翻成统一方向（source=输出端, target=输入端）；非法朝向返回 null */
export function toCanonicalConnection(c: ConnectionInput): CanonicalEndpoints | null {
  const n = normalizeConnection(c)
  if (n.sourceHandle === 'source' && n.targetHandle === 'target') return { source: n.source, target: n.target }
  if (n.sourceHandle === 'target' && n.targetHandle === 'source')
    return { source: n.target, target: n.source }
  return null
}

/** 已有边 canonical 端点（缺 handle 归一后同 toCanonical 语义） */
export function getCanonicalEndpoints(e: ExistingEdge): CanonicalEndpoints | null {
  const sh = e.sourceHandle || 'source'
  const th = e.targetHandle || 'target'
  if (sh === 'source' && th === 'target') return { source: e.source, target: e.target }
  if (sh === 'target' && th === 'source') return { source: e.target, target: e.source }
  return null
}

/** 该边是否 isTemp */
function isTempEdge(e: ExistingEdge): boolean {
  return Boolean(e.data?.isTemp)
}

/**
 * 判断"加一条 source→target"是否会成环（v1 wouldCreateCycle 原样）：
 * 已有边若存在"target →…→ source"的正向路径，则补上 source→target 就成环。
 * 从 target 出发沿"正向(source→target)"边 DFS，能走回 source 即成环。
 */
export function wouldCreateCycle(source: string, target: string, edges: ExistingEdge[]): boolean {
  if (source === target) return true
  const real = edges.filter((e) => !isTempEdge(e))
  // 正向邻接：from -> [tos]
  const adj = new Map<string, string[]>()
  for (const e of real) {
    const ep = getCanonicalEndpoints(e)
    if (!ep) continue
    if (!adj.has(ep.source)) adj.set(ep.source, [])
    adj.get(ep.source)!.push(ep.target)
  }
  const stack = [target]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop()!
    if (cur === source) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    for (const nxt of adj.get(cur) ?? []) {
      if (!visited.has(nxt)) stack.push(nxt)
    }
  }
  return false
}

/** 一条已有边是否与 canonical 端点相同（跨 handle 归一比较） */
export function isSameConnection(edge: ExistingEdge, canonical: CanonicalEndpoints): boolean {
  if (isTempEdge(edge)) return false
  const ep = getCanonicalEndpoints(edge)
  return !!ep && ep.source === canonical.source && ep.target === canonical.target
}

/** 找已存在的同一条连接（去重用，忽略 isTemp） */
export function findDuplicate(canonical: CanonicalEndpoints, edges: ExistingEdge[]): ExistingEdge | undefined {
  return edges.find((e) => isSameConnection(e, canonical))
}

// ============================================================================
// 连接校验服务
// ============================================================================

/**
 * 校验一条新连接是否可建，返回原因。严格规则 = v1 isValidConnection/getInvalidConnectionReason 原样吸收，
 * 外加声明式 accepts/limit。
 */
export function validateConnection(
  conn: ConnectionInput,
  ctx: ValidateContext,
  opts: { allowMissingNodes?: boolean } = {},
): ValidationResult {
  const { allowMissingNodes = false } = opts
  const fail = (reason: InvalidReason): ValidationResult => ({ ok: false, reason })

  const canonical = toCanonicalConnection(conn)
  if (!canonical) return fail('bad-orientation') // 只接受 source→target 或反接翻正
  if (!canonical.source || !canonical.target) return fail('missing-node')
  if (canonical.source === canonical.target) return fail('self-loop')

  const src = ctx.nodes.get(canonical.source)
  const tgt = ctx.nodes.get(canonical.target)
  // v1 注：刷新载入时两端节点可能还没进索引——此时放行避免历史边被误判丢。手动拖线两端必在。
  if (!src || !tgt) return allowMissingNodes ? { ok: true, canonical, reason: 'ok' as const } : fail('missing-node')

  const srcConn = ctx.getTypeConn(src.type)
  const tgtConn = ctx.getTypeConn(tgt.type)

  // 输出/输入端口能力：type 声明 outputs 存在且非空才算有 source 口；未声明默认都有（BaseNode 人人带 source+target）
  const hasSourcePort = !srcConn?.outputs || srcConn.outputs.length > 0
  if (!hasSourcePort) return fail('no-source-port')
  const hasTargetPort = !tgtConn?.inputs || tgtConn.inputs.length > 0
  if (!hasTargetPort) return fail('no-target-port')

  // 声明式 accepts：target 的 inputs(port='target').accepts 限定可接受的源类型
  const inputDef = tgtConn?.inputs?.find((i) => !i.port || i.port === 'target')
  if (inputDef?.accepts && inputDef.accepts.length > 0 && !inputDef.accepts.includes(src.type)) {
    return fail('type-not-accepted')
  }

  // 环检测
  if (wouldCreateCycle(canonical.source, canonical.target, ctx.edges)) return fail('cycle')

  // 去重：同一条 canonical 连接只允许一条
  if (findDuplicate(canonical, ctx.edges)) return fail('duplicate')

  // limit:'single'：该输入端口只允许一条入边
  if (inputDef?.limit === 'single') {
    const intoInput = ctx.edges.some(
      (e) => !isTempEdge(e) && getCanonicalEndpoints(e)?.target === canonical.target,
    )
    if (intoInput) return fail('limit-reached')
  }

  return { ok: true, canonical, reason: 'ok' }
}

/** 便捷：从 nodeStore 的类型定义反查连接声明（无 inputs/outputs 返回 undefined） */
export function typeConnectionDef(def: { inputs?: PortDef[]; outputs?: PortDef[] } | undefined): NodeConnectionDef | undefined {
  if (!def) return undefined
  return def.inputs || def.outputs ? { inputs: def.inputs, outputs: def.outputs } : undefined
}
