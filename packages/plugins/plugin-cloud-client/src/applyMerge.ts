// 把一轮「云端变化」落到本地画布。
//
// 这里有一个必须守住的细节：进度帧不能进撤销栈。
//
// 后台推进任务时，每写一帧 runState 都会经实时通道同步过来。如果整批都包进事务，
// 用户按一次 Ctrl+Z 只会退掉一格进度条 —— 真正的作品改动要按几十次才退得动。
// 所以把"只改了 runState 的节点"择出来，用 updateNodeRuntime 单独落（那条不进历史），
// 其余（真的改了内容的）才走事务。

export interface MergePlanLike {
  addNodes: unknown[]
  removeNodeIds: string[]
  updateNodes: unknown[]
  addEdges: unknown[]
  removeEdgeIds: string[]
  updateEdges: unknown[]
  reassignNodeIds?: Array<{ from: string; to: string }>
  unsetDataKeys?: Record<string, string[]>
}

export interface DocLike {
  getNode(id: string): {
    id?: string
    type?: string
    position?: unknown
    data?: Record<string, unknown>
    size?: unknown
    parentId?: string
  } | undefined
  /** 当前本地边（换 id 时要一起重连；与 localEdges 二选一，真实 doc 服务提供的是这个） */
  getEdges?(): unknown[]
  /** 当前本地边（换 id 时要一起重连；旧宿主可缺省） */
  localEdges?(): Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    type?: string
    data?: Record<string, unknown>
  }>
  /** 某节点的子节点（换 id 时要改它们的 parentId） */
  childNodesOf?(id: string): Array<{ id: string }>
  removeEdges(ids: string[]): unknown
  removeNodes(ids: string[]): unknown
  addNodes(inputs: unknown[]): unknown
  updateNode(id: string, patch: unknown): void
  updateNodeRuntime(id: string, patch: unknown): void
  connectEdge(input: unknown): unknown
  transaction<T>(reason: string, fn: () => T): T
}

/** 换 id 时要重连的边（从宿主原样拿到的最小形状） */
type LocalEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  data?: Record<string, unknown>
}

/** 只保留形状合格的边；坏条目跳过，不把 undefined 当端点传出去 */
function normalizeLocalEdges(raw: unknown[]): LocalEdge[] {
  const out: LocalEdge[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') continue
    out.push({
      id: e.id,
      source: e.source,
      target: e.target,
      ...(typeof e.sourceHandle === 'string' ? { sourceHandle: e.sourceHandle } : {}),
      ...(typeof e.targetHandle === 'string' ? { targetHandle: e.targetHandle } : {}),
      ...(typeof e.type === 'string' ? { type: e.type } : {}),
      ...(e.data && typeof e.data === 'object' ? { data: { ...(e.data as Record<string, unknown>) } } : {}),
    })
  }
  return out
}

/** 两边的 data 有哪些 key 变了（用来判断"是不是只有 runState 动了"） */
export function diffDataKeys(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string[] {
  const a = before ?? {}
  const b = after ?? {}
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out: string[] = []
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k)
  }
  return out
}

/** 这一条更新是否"只动了运行期状态"（这种不进撤销栈） */
export function isRuntimeOnly(
  localData: Record<string, unknown> | undefined,
  nextData: Record<string, unknown> | undefined,
): boolean {
  const keys = diffDataKeys(localData, nextData)
  return keys.length === 1 && keys[0] === 'runState'
}

/** 把一轮合并结果落到本地（进度帧单独落，其余走事务） */
export function applyMergePlan(doc: DocLike, plan: MergePlanLike): void {
  const runtimeOnly: Array<{ id: string; runState: unknown }> = []
  const structural: unknown[] = []
  for (const raw of plan.updateNodes) {
    const node = raw as { id: string; data?: Record<string, unknown> }
    const local = doc.getNode(node.id)
    if (isRuntimeOnly(local?.data, node.data)) runtimeOnly.push({ id: node.id, runState: (node.data ?? {}).runState })
    else structural.push(raw)
  }

  for (const r of runtimeOnly) doc.updateNodeRuntime(r.id, { data: { runState: r.runState } })

  const renames = plan.reassignNodeIds ?? []
  // 旧宿主没有关联信息时不做换 id；如果这一轮只剩换 id，直接返回，不留下空撤销记录。
  /*
   * 真实宿主（DocService）暴露的是 getEdges，不是 localEdges —— 换号能力原先只认后者，
   * 于是生产环境被误判成“旧宿主”：碰撞时不换号，紧接着新增云端同号节点抛
   * "node id already exists"，整轮合并回滚，版本却已经推进。表现就是“版本对了，节点没出现”。
   * 两种取边口都认，childNodesOf 仍必须有（否则改不了子节点的 parentId，宁可不动）。
   */
  const readEdges: (() => unknown[]) | undefined = doc.localEdges ?? doc.getEdges
  const canRename = typeof readEdges === 'function' && typeof doc.childNodesOf === 'function'
  const effectiveRenames = canRename ? renames : []

  const nothingElse =
    structural.length === 0 &&
    plan.addNodes.length === 0 &&
    plan.removeNodeIds.length === 0 &&
    plan.addEdges.length === 0 &&
    plan.removeEdgeIds.length === 0 &&
    plan.updateEdges.length === 0 &&
    effectiveRenames.length === 0
  if (nothingElse) return

  doc.transaction('云端/AI 改动', () => {
    /*
     * 同 id 碰撞：先把本地节点换成新 id（保留本地内容），再让云端节点用原 id 接入。
     * 不能只改节点 id：边端点与子节点 parentId 指向它时都要同步改，否则线断、分组散。
     */
    // 旧宿主没有 localEdges / childNodesOf 时不做换 id：只改节点 id、不改引用会留下悬挂线/分组。
    // 这类宿主仍按旧行为（云端节点被忽略），但至少不产生静默坏引用。
    for (const r of effectiveRenames) {
      const node = doc.getNode(r.from)
      if (!node) continue
      const localEdges = normalizeLocalEdges(readEdges?.() ?? []).filter(
        (e) => e.source === r.from || e.target === r.from,
      )
      doc.removeEdges(localEdges.map((e) => e.id))
      doc.removeNodes([r.from])
      doc.addNodes([{ ...node, id: r.to }])
      for (const e of localEdges) {
        doc.connectEdge({
          ...e,
          source: e.source === r.from ? r.to : e.source,
          target: e.target === r.from ? r.to : e.target,
        })
      }
      // 子节点的 parentId 也要指向新 id；不能只保留父节点本身。
      for (const child of doc.childNodesOf?.(r.from) ?? []) {
        doc.updateNode(child.id, { parentId: r.to })
      }
    }
    doc.removeEdges(plan.removeEdgeIds)
    doc.removeNodes(plan.removeNodeIds)
    if (plan.addNodes.length > 0) doc.addNodes(plan.addNodes)
    for (const raw of structural) {
      const n = raw as { id: string; position?: unknown; data?: unknown; size?: unknown; parentId?: unknown }
      doc.updateNode(n.id, {
        ...(n.position ? { position: n.position } : {}),
        ...(n.data ? { data: { ...(n.data as Record<string, unknown>) } } : {}),
        ...(n.size ? { size: n.size } : {}),
        ...(n.parentId !== undefined ? { parentId: n.parentId } : {}),
        ...(plan.unsetDataKeys?.[n.id]?.length ? { dataUnset: plan.unsetDataKeys[n.id] } : {}),
      })
    }
    for (const e of plan.updateEdges) {
      doc.removeEdges([(e as { id: string }).id])
      doc.connectEdge(e)
    }
    for (const e of plan.addEdges) doc.connectEdge(e)
  })
}
