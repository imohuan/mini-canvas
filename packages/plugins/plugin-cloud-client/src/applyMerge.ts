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
}

export interface DocLike {
  getNode(id: string): { data?: Record<string, unknown> } | undefined
  removeEdges(ids: string[]): unknown
  removeNodes(ids: string[]): unknown
  addNodes(inputs: unknown[]): unknown
  updateNode(id: string, patch: unknown): void
  updateNodeRuntime(id: string, patch: unknown): void
  connectEdge(input: unknown): unknown
  transaction<T>(reason: string, fn: () => T): T
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

  const nothingElse =
    structural.length === 0 &&
    plan.addNodes.length === 0 &&
    plan.removeNodeIds.length === 0 &&
    plan.addEdges.length === 0 &&
    plan.removeEdgeIds.length === 0 &&
    plan.updateEdges.length === 0
  if (nothingElse) return

  doc.transaction('云端/AI 改动', () => {
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
      })
    }
    for (const e of plan.updateEdges) {
      doc.removeEdges([(e as { id: string }).id])
      doc.connectEdge(e)
    }
    for (const e of plan.addEdges) doc.connectEdge(e)
  })
}
