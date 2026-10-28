/**
 * slotOrder —— 槽内条目的顺序解析（纯逻辑，零 Vue）。
 *
 * 为什么单独一层：UI 槽、底栏动作、右键菜单、节点区域、设置分组都会遇到同一个问题——
 * "我想排在某个已知条目前面/后面"，而数字 order 只能表达绝对优先级。
 *
 * 规则：
 * - id 是**槽内条目 id**（如 host/agent、my-plugin/export），不是槽名；
 * - before / after 表示"紧挨着目标"（插到它正前 / 正后），不是"只要在它前/后就行"；
 * - 目标不存在 → 忽略该约束，退回 order；
 * - order 缺省用 fallbackOrder（默认 1000）；同 order 保持传入顺序；
 * - 多个条目指向同一目标时，保持它们之间的传入顺序；
 * - 环 / 自引用 / 重复 id 报告问题，按 order 兜底，不丢条目。
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
 * 算法：
 * 1. 去重（保留传入顺序先者）+ 按 order 稳定排序，得到基础顺序；
 * 2. 反复应用 before/after：把条目**移到目标旁边**（before = 目标前，after = 目标后）；
 * 3. 多轮仍不收敛 = 有环：报告并回到基础顺序。
 *
 * 为什么不是拓扑排序：拓扑只保证"在目标前/后"，会把条目甩到很远；
 * 用户要的是"插在这个按钮旁边"，所以这里用"相邻插入"语义。
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

  // 基础顺序：order 升序；同 order 保持传入顺序
  const base = [...byId.values()]
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.order ?? fallbackOrder) - (b.item.order ?? fallbackOrder) ||
        a.index - b.index,
    )
    .map(({ item }) => item)

  // 约束：目标不存在 / 自引用在这里先剔除
  interface Constraint {
    mover: string
    target: string
    side: 'before' | 'after'
  }
  const constraints: Constraint[] = []
  for (const item of base) {
    for (const [side, rawTarget] of [
      ['before', item.before],
      ['after', item.after],
    ] as const) {
      if (!rawTarget) continue
      if (rawTarget === item.id) {
        report({ id: item.id, kind: 'self-reference', target: rawTarget })
        continue
      }
      if (!byId.has(rawTarget)) {
        report({ id: item.id, kind: 'missing-target', target: rawTarget })
        continue
      }
      constraints.push({ mover: item.id, target: rawTarget, side })
    }
  }

  if (constraints.length === 0) return { items: base, issues }

  // 2) 相邻插入：before 正序、after 逆序，保证多个条目保持传入顺序
  const order = base.map((item) => item.id)
  const beforeConstraints = constraints.filter((c) => c.side === 'before')
  const afterConstraints = constraints.filter((c) => c.side === 'after').reverse()

  /** 应用一轮；返回是否发生变化 */
  function applyPass(): boolean {
    let changed = false
    for (const c of beforeConstraints) {
      const from = order.indexOf(c.mover)
      const target = order.indexOf(c.target)
      if (from < 0 || target < 0) continue
      if (from + 1 === target) continue // 已在目标正前
      order.splice(from, 1)
      const nextTarget = order.indexOf(c.target)
      order.splice(nextTarget, 0, c.mover)
      changed = true
    }
    for (const c of afterConstraints) {
      const from = order.indexOf(c.mover)
      const target = order.indexOf(c.target)
      if (from < 0 || target < 0) continue
      if (from === target + 1) continue // 已在目标正后
      order.splice(from, 1)
      const nextTarget = order.indexOf(c.target)
      order.splice(nextTarget + 1, 0, c.mover)
      changed = true
    }
    return changed
  }

  const maxPasses = constraints.length + 1
  let passes = 0
  while (applyPass() && passes < maxPasses) passes += 1

  // 3) 没有收敛 = 有环：报告并回到基础顺序
  if (passes >= maxPasses) {
    for (const c of constraints) report({ id: c.mover, kind: 'cycle' })
    return { items: base, issues }
  }

  const byOrder = new Map(order.map((id, index) => [id, index]))
  return {
    items: [...byId.values()].sort(
      (a, b) => (byOrder.get(a.id) ?? 0) - (byOrder.get(b.id) ?? 0),
    ),
    issues,
  }
}
