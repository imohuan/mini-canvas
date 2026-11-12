/**
 * slotOrder —— 槽内条目的顺序解析（纯逻辑，零 Vue）。
 *
 * 用户规则（2026-10-28 定稿）：
 * 1. 默认先按 order 排（小者在前；同 order 保持传入顺序）；
 * 2. before / after 优先级更高——把条目插到目标的正前 / 正后；
 * 3. **多个条目指向同一个目标时，它们之间按 order 排**；
 * 4. before 与 after 同时写：**只认 before，忽略 after**（并报告 conflict）。
 *
 * 实现要点：不能靠"反复把条目挪到目标旁边"——两个 after 指向同一个目标时，
 * 后一个会把前一个挤走，最终它们被甩到目标前面（2026-10-28 实测 bug）。
 * 这里改成**一次成型的挂载**：把每个目标下的 before/after 各自按 order 排好，
 * 再按"目标 → 前插 → 自身 → 后插"展开。
 */

/** 参与排序的最小条目形状 */
export interface SlotOrderItem {
  id: string
  order?: number
  /** 紧挨着排在该条目之前（填槽内条目 id） */
  before?: string
  /** 紧挨着排在该条目之后（填槽内条目 id） */
  after?: string
}

export type SlotOrderIssueKind =
  | 'missing-target'
  | 'self-reference'
  | 'cycle'
  | 'duplicate-id'
  /** 同时写了 before 与 after：只认 before */
  | 'conflict'

/** 排序时发现的问题（调用方可选择 warn / 忽略 / 诊断展示） */
export interface SlotOrderIssue {
  id: string
  kind: SlotOrderIssueKind
  target?: string
}

export interface SlotOrderOptions {
  /** 没有显式 order 时的兜底值（默认 1000，排在显式小 order 的内置项之后） */
  fallbackOrder?: number
  /** 每发现一个问题回调一次（同一问题可能随重排重复出现，调用方自行去重） */
  onIssue?: (issue: SlotOrderIssue) => void
}

/** 缺省 order：显式 order 通常给内置项留 0~999，未声明者排后面 */
export const SLOT_ORDER_FALLBACK = 1000

/**
 * 把条目按 order + before/after 排出最终顺序。
 *
 * 返回值里的 issues 只报告"约束没生效"的情况；正常排序 issues 为空。
 */
export function orderSlotItems<T extends SlotOrderItem>(
  items: readonly T[],
  opts: SlotOrderOptions = {},
): { items: T[]; issues: SlotOrderIssue[] } {
  const fallbackOrder = opts.fallbackOrder ?? SLOT_ORDER_FALLBACK
  const issues: SlotOrderIssue[] = []
  const report = (issue: SlotOrderIssue): void => {
    issues.push(issue)
    opts.onIssue?.(issue)
  }

  // 1) 去重：保留传入顺序里最先出现的那条（本地锚点先传入 → 本地优先）
  const byId = new Map<string, T>()
  for (const item of items) {
    if (byId.has(item.id)) {
      report({ id: item.id, kind: 'duplicate-id' })
      continue
    }
    byId.set(item.id, item)
  }

  // 2) 基础顺序：order 升序；同 order 保持传入顺序
  const base = [...byId.values()]
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.order ?? fallbackOrder) - (b.item.order ?? fallbackOrder) ||
        a.index - b.index,
    )
    .map(({ item }) => item)
  if (base.length === 0) return { items: [], issues }

  const rank = new Map(base.map((item, index) => [item.id, index]))
  const orderOf = (item: T): number => item.order ?? fallbackOrder

  // 3) 归组：每个条目要么是"相对某目标"，要么是"根"（独立按 order 排）
  type Relation = { target: string; side: 'before' | 'after' }
  const relation = new Map<string, Relation>()
  for (const item of base) {
    const before = item.before
    const after = item.after
    if (before && after) {
      // 用户口径：同时写 before 与 after 不推荐，只认 before
      report({ id: item.id, kind: 'conflict', target: before })
    }
    const rawTarget = before || after
    const side: 'before' | 'after' = before ? 'before' : 'after'
    if (!rawTarget) continue
    if (rawTarget === item.id) {
      report({ id: item.id, kind: 'self-reference', target: rawTarget })
      continue
    }
    if (!byId.has(rawTarget)) {
      report({ id: item.id, kind: 'missing-target', target: rawTarget })
      continue
    }
    relation.set(item.id, { target: rawTarget, side })
  }

  // 4) 找根：沿着 relation 往上走；遇到环就整体降级（环上的条目全部回到 order）
  const rootOf = (id: string): string | undefined => {
    const seen = new Set<string>()
    let cur = id
    while (relation.has(cur)) {
      if (seen.has(cur)) return undefined // 环
      seen.add(cur)
      cur = relation.get(cur)!.target
    }
    return cur
  }
  const cyclic = new Set<string>()
  for (const item of base) {
    if (relation.has(item.id) && rootOf(item.id) === undefined) {
      cyclic.add(item.id)
      report({ id: item.id, kind: 'cycle' })
    }
  }
  for (const id of cyclic) relation.delete(id)

  // 5) 以"根"为桶收集：before / after 各自按 order 排（同 order 保持传入序）
  const beforeGroups = new Map<string, T[]>()
  const afterGroups = new Map<string, T[]>()
  for (const item of base) {
    const rel = relation.get(item.id)
    if (!rel) continue
    // 嵌套：A after B、B after C → A 也挂到 C 的 after 桶，但要排在 B 后面
    const root = rootOf(item.id) ?? rel.target
    const bucket = (rel.side === 'before' ? beforeGroups : afterGroups)
    const list = bucket.get(root) ?? []
    list.push(item)
    bucket.set(root, list)
  }
  const byOrderThenIndex = (a: T, b: T): number =>
    orderOf(a) - orderOf(b) || (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
  for (const list of beforeGroups.values()) list.sort(byOrderThenIndex)
  for (const list of afterGroups.values()) list.sort(byOrderThenIndex)

  // 6) 展开：根按 order 排；每根输出 "前插项 → 根自身 → 后插项"
  const out: T[] = []
  const emitted = new Set<string>()
  const emit = (item: T): void => {
    if (emitted.has(item.id)) return
    emitted.add(item.id)
    // 前插项里也可能嵌套别的条目（A before B、C before A）
    for (const child of beforeGroups.get(item.id) ?? []) emit(child)
    if (!out.includes(item)) out.push(item)
    for (const child of afterGroups.get(item.id) ?? []) emit(child)
  }
  for (const item of base) {
    if (relation.has(item.id)) continue // 不是根，稍后随根展开
    emit(item)
  }
  // 兜底：没有任何根的（理论上只剩环已删除的情况）
  for (const item of base) emit(item)

  return { items: out, issues }
}
