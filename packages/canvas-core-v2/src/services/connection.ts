/**
 * connection —— v2 连接内核（M5 加固：把 v1 useCanvasConnection + ConnectionValidator 的严格校验
 * **原样吸收**，不许改坏）。纯逻辑、零 Vue、可 Node 单测。
 *
 * 吸收的 v1 规则（见 docs/adr/0001 行动项 3 + api.md §七）：
 * - normalizeConnection：缺 handle 归一成 'source'/'target'
 * - toCanonicalConnection：只允许 source→target 或 target→source(反向自动翻正)，其它朝向非法
 * - wouldCreateCycle：DFS 环检测（忽略中间态边）
 * - 重复边检测（同一条 canonical 连接只允许一条，忽略中间态边）
 * - 声明式 inputs/accepts/limit（api.md §四）：target 的 inputs[].accepts 限定能接哪些源类型；
 *   limit:'single' 限定某输入端口只接一条
 *
 * 注意：canonical 语义 = 输出端 handle 'source' 在 source 节点、输入端 handle 'target' 在 target 节点。
 */
import { isTransient } from './transient'

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
  /** 该端口接受的源节点类型列表；缺省/空 = 来者不拒（旧模型：按源节点 type） */
  accepts?: string[]
  /** 'single' = 该端口只允许一条连接；缺省 = 多条 */
  limit?: 'single' | 'multi'
  /** 输出口产出/输入口接收的内容类型（image/text/video/audio…，跨节点语义）。
   *  目标输入口声明 acceptsTypes 时，源的产出 contentType 必须 ∈ 它。缺省不限制。 */
  contentType?: string
  /** 输入口接受的内容类型列表；缺省/空 = 不按内容类型限制 */
  acceptsTypes?: string[]
  /** 输入口最多接几条入边（缺省 1）；>1 允许多条、满额时由调用方决定挤最老 */
  capacity?: number
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
  /** 已存在边（含中间态标记） */
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

/** 翻成统一方向（source=输出端, target=输入端）；非法朝向返回 null。
 * P0-6 多端口：sourceHandle/targetHandle 为自定义端口名（非 source/target）时无法仅凭字符串判方向——
 * 按调用侧约定（source 节点=输出端、target 节点=输入端）视为正向，不做翻转；
 * 端口是否存在由 resolveSourceOutputPort/resolveTargetInputPort 在类型声明里校验。
 */
export function toCanonicalConnection(c: ConnectionInput): CanonicalEndpoints | null {
  const n = normalizeConnection(c)
  if (n.sourceHandle === 'source' && n.targetHandle === 'target') return { source: n.source, target: n.target }
  if (n.sourceHandle === 'target' && n.targetHandle === 'source')
    return { source: n.target, target: n.source }
  // 两端都自定义名（多端口）→ 正向；一端默认一端自定义混用 → 仍按默认 source/target 判定
  if (n.sourceHandle !== 'source' && n.sourceHandle !== 'target' && n.targetHandle !== 'source' && n.targetHandle !== 'target') {
    return { source: n.source, target: n.target }
  }
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

/**
 * 判断"加一条 source→target"是否会成环（v1 wouldCreateCycle 原样）：
 * 已有边若存在"target →…→ source"的正向路径，则补上 source→target 就成环。
 * 从 target 出发沿"正向(source→target)"边 DFS，能走回 source 即成环。
 */
export function wouldCreateCycle(source: string, target: string, edges: ExistingEdge[]): boolean {
  if (source === target) return true
  const real = edges.filter((e) => !isTransient(e))
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
  if (isTransient(edge)) return false
  const ep = getCanonicalEndpoints(edge)
  return !!ep && ep.source === canonical.source && ep.target === canonical.target
}

/** 找已存在的同一条连接（去重用，忽略中间态边） */
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
  const norm = normalizeConnection(conn)
  // P0-6 多端口：端口能力与目标口解析统一走 resolve* —— 声明了 inputs/outputs 的类型，
  // 自定义 handle 必须精确命中声明端口（否则 no-source-port/no-target-port）；缺省 handle/未声明类型兼容旧语义。
  const srcOutputDef = resolveSourceOutputPort(srcConn, norm.sourceHandle)
  const inputDef = resolveTargetInputPort(tgtConn, norm.targetHandle)
  // 未声明 outputs/inputs 或声明非空 → 有口（旧语义）；声明非空时自定义 handle 需命中（srcOutputDef/inputDef 已解析）
  const hasSourcePort = !srcConn?.outputs || srcConn.outputs.length > 0
  if (!hasSourcePort) return fail('no-source-port')
  const hasTargetPort = !tgtConn?.inputs || tgtConn.inputs.length > 0
  if (!hasTargetPort) return fail('no-target-port')
  // 自定义 handle 精确匹配失败（类型声明了端口但 handle 不在其中）→ 该端口不存在
  if (norm.sourceHandle !== 'source' && srcConn?.outputs && srcConn.outputs.length > 0 && !srcOutputDef) return fail('no-source-port')
  if (norm.targetHandle !== 'target' && tgtConn?.inputs && tgtConn.inputs.length > 0 && !inputDef) return fail('no-target-port')
  if (inputDef?.accepts && inputDef.accepts.length > 0 && !inputDef.accepts.includes(src.type)) {
    return fail('type-not-accepted')
  }
  // 声明式内容类型：源输出口产 contentType，目标输入口声明 acceptsTypes → 源产出必须 ∈ 它。
  // 只在双方都有内容类型声明时启用（source 无产出类型声明 → 视为不受内容类型约束）。
  const srcContent = srcOutputDef?.contentType
  if (
    srcContent &&
    inputDef?.acceptsTypes &&
    inputDef.acceptsTypes.length > 0 &&
    !inputDef.acceptsTypes.includes(srcContent)
  ) {
    return fail('type-not-accepted')
  }

  // 环检测
  if (wouldCreateCycle(canonical.source, canonical.target, ctx.edges)) return fail('cycle')

  // 去重：同一条 canonical 连接只允许一条
  if (findDuplicate(canonical, ctx.edges)) return fail('duplicate')

  // 目标输入端口容量：只有"显式声明了 inputs"的类型才受容量约束。
  // 声明条目里 capacity 缺省/<=0 视为 1（与 connection/capability 语义一致），
  // 因此 capacity:1 与 limit:'single' 等效，都应在提交前把已有入边的候选拦下。
  // 未声明任何 inputs 的类型保持旧行为：不限制入边条数。
  if (inputDef) {
    const capacity = inputDef.capacity === undefined || inputDef.capacity <= 0 ? 1 : inputDef.capacity
    // 本次连接实际占用的输入口名：具名 handle 用它；默认 handle（含缺省）用 resolveTargetInputPort
    // 落到的口的 port（缺省口可能为 undefined = 传统默认 target 口）。
    // 容量只统计"连到同一口"的现有边（C-1：纯具名多口类型各口容量独立，互不挤占）。
    const effectivePort = inputDef?.port ?? undefined // 传统默认口(无具名)亦为 undefined
    const intoInput = ctx.edges.filter(
      (e) =>
        !isTransient(e) &&
        // 多端口已有边(自定义 handle) canonical 提取失败，直接用 e.target 判目标节点
        (getCanonicalEndpoints(e)?.target === canonical.target || (!getCanonicalEndpoints(e) && e.target === canonical.target)) &&
        // 现有边 handle 归一到目标口：无 handle/默认 target 口 视为默认口；否则精确匹配具名口
        ((effectivePort === undefined ? !e.targetHandle || e.targetHandle === 'target' : e.targetHandle === effectivePort)),
    ).length
    if (inputDef.limit === 'single' || capacity === 1 ? intoInput > 0 : intoInput >= capacity) {
      return fail('limit-reached')
    }
  }

  return { ok: true, canonical, reason: 'ok' }
}

/**
 * 解析目标节点的"目标输入口"定义（P0-6 多端口：不再只认第一个/默认口）。
 * - targetHandle 缺省/null/'target' → 返回默认输入口（port 缺省或 'target' 的条目；多个时取第一个，兼容旧语义）；
 * - targetHandle 为自定义名 → 在 inputs 里按 port===targetHandle 精确匹配；
 * - 未命中 → undefined（调用方按 bad-orientation/no-target-port 拒绝）。
 * 未声明 inputs → undefined。
 */
export function resolveTargetInputPort(
  typeConn: NodeConnectionDef | undefined,
  targetHandle: string | null | undefined,
): PortDef | undefined {
  const inputs = typeConn?.inputs
  if (!inputs || inputs.length === 0) return undefined
  if (targetHandle && targetHandle !== 'target') {
    return inputs.find((i) => i.port === targetHandle)
  }
  // 默认口：优先未命名/名为 target 的口；纯具名多端口类型则退回第一个口（默认接第一个输入口）
  return inputs.find((i) => !i.port || i.port === 'target') ?? inputs[0]
}

/**
 * 解析源节点的"源输出口"定义（P0-6 多端口，与 resolveTargetInputPort 对称）。
 * - sourceHandle 缺省/null/'source' → 默认输出口（port 缺省或 'source'）；
 * - 自定义名 → 按 port===sourceHandle 精确匹配；未命中 → undefined。
 * 未声明 outputs → undefined。
 */
export function resolveSourceOutputPort(
  typeConn: NodeConnectionDef | undefined,
  sourceHandle: string | null | undefined,
): PortDef | undefined {
  const outputs = typeConn?.outputs
  if (!outputs || outputs.length === 0) return undefined
  if (sourceHandle && sourceHandle !== 'source') {
    return outputs.find((o) => o.port === sourceHandle)
  }
  // 默认口：优先未命名/名为 source 的口；纯具名多端口类型则退回第一个口
  return outputs.find((o) => !o.port || o.port === 'source') ?? outputs[0]
}

/** 便捷：从 nodeStore 的类型定义反查连接声明（无 inputs/outputs 返回 undefined） */
export function typeConnectionDef(def: { inputs?: PortDef[]; outputs?: PortDef[] } | undefined): NodeConnectionDef | undefined {
  if (!def) return undefined
  return def.inputs || def.outputs ? { inputs: def.inputs, outputs: def.outputs } : undefined
}















