// branchNav - history list grouping + INLINE branch pagers (pure logic).
//
// Spec (user 2026-10-07): the branch pager FOLLOWS ITS MESSAGE - it renders right
// after the forked position's reply block inside the stream (between that reply and
// the next user message), NOT as a global footer. Flipping it switches to another
// version of that SAME position; other versions do not contain messages sent after
// their fork. Editing the same position again chains the versions into one group
// (edit A -> B -> C reads as one 3-version group) rendered at that position in
// every member session.
//
// Spec (2026-10-06, kept): one conversation = one row in the history list,
// regardless of how many branches it has.
export interface SessionRow {
  id: string
  title: string
  updatedAt: number
  createdAt?: number
  preview?: string
}

/** One conversation = one branch tree (root session + descendants); the list shows the root. */
export interface ConversationGroup {
  rootId: string
  memberIds: string[]
  meta: SessionRow
}

/** child -> parent derived from the fork registry; first record wins (a session forks once). */
function parentMapOf(points: Array<{ parentId: string; point: string; children: string[] }>): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of points) for (const c of p.children) if (!map.has(c)) map.set(c, p.parentId)
  return map
}

function rootOf(map: Map<string, string>, id: string): string {
  let cur = id
  const seen = new Set<string>([id])
  for (;;) {
    const parent = map.get(cur)
    if (!parent || seen.has(parent)) return cur
    seen.add(parent)
    cur = parent
  }
}

export function groupConversations(rows: SessionRow[], parents: Record<string, string>): ConversationGroup[] {
  const map = new Map(Object.entries(parents))
  const byId = new Map(rows.map((s) => [s.id, s]))
  const groups = new Map<string, string[]>()
  for (const s of rows) {
    const root = rootOf(map, s.id)
    const list = groups.get(root) ?? []
    list.push(s.id)
    groups.set(root, list)
  }
  const out: ConversationGroup[] = []
  for (const [rootId, memberIds] of groups) {
    const members = memberIds.map((id) => byId.get(id)).filter((s): s is SessionRow => !!s)
    const latest = Math.max(...members.map((m) => m.updatedAt))
    const rootMeta = byId.get(rootId)
    const meta: SessionRow = rootMeta ?? [...members].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    out.push({
      rootId,
      memberIds: [rootId, ...members.map((m) => m.id).filter((id) => id !== rootId).sort()].filter((id) => byId.has(id)),
      meta: { ...meta, updatedAt: latest },
    })
  }
  return out.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
}

export interface BranchNavItem {
  id: string
  label: string
}

/** 一个分叉点（服务端 branch-info 返回的形状；userOrdinal 由服务端按当前转录算） */
export interface ForkPoint {
  parentId: string
  point: string
  children: string[]
  /** 该位置是当前会话里的第几个用户消息（0 基）；缺省 = 服务端没算出来，不渲染 */
  userOrdinal?: number
}

/**
 * 一个内联分页器：渲染在「第 userOrdinal 个用户消息的回复块之后」。
 *
 * 渲染规则（组件实现）：当前会话的用户消息序列里，
 * 分页器插在 users[userOrdinal] 的回复块与 users[userOrdinal+1] 之间；
 * 没有 users[userOrdinal+1] 时放列表末尾（= 该版本最后一条回复的下面）。
 */
export interface PagerGroup {
  /** 转录里的 fork 下标（存储下标，排障用） */
  at: number
  /** 该位置是当前会话里的第几个用户消息（0 基） */
  userOrdinal: number
  items: BranchNavItem[]
  /** 当前会话在 items 里的 0 基位置 */
  index: number
  position: number
  total: number
}

/** 'turn:3' -> 3；解析不出返回 null（老数据 / 未来格式） */
function parseTurnPoint(point: string): number | null {
  const m = /^turn:(\d+)$/.exec(point)
  return m ? Number(m[1]) : null
}

/**
 * 当前会话的全部内联分页器（跟随消息）。
 *
 * 1. fork 点 (P, turn:N) = 在位置 N 的一次编辑；连续编辑同一位置会形成一条链
 *    （A←B←C），同一个位置沿链收集成**一个组**；
 * 2. 一个会话可能同时属于两个组（它编辑过别人、自己又被编辑过）→ 两个分页器；
 * 3. userOrdinal 由服务端按当前转录现算（分叉前缀逐字拷贝，同组各版本一致）。
 */
export function inlinePagers(
  currentId: string,
  rows: SessionRow[],
  points: ForkPoint[],
): PagerGroup[] {
  const byId = new Map(rows.map((s) => [s.id, s]))
  // parentId -> (N -> children[])：**不过滤已删**，否则删掉链中间一条会把组截断
  const forkMap = new Map<string, Map<number, string[]>>()
  // N -> userOrdinal（同一 N 在任何父会话下都同值：它数的是「N 之前有几个用户消息」）
  const ordinalOf = new Map<number, number>()
  for (const pt of points) {
    const n = parseTurnPoint(pt.point)
    if (n === null) continue
    if (pt.userOrdinal !== undefined && !ordinalOf.has(n)) ordinalOf.set(n, pt.userOrdinal)
    const inner = forkMap.get(pt.parentId) ?? new Map<number, string[]>()
    const list = inner.get(n) ?? []
    for (const c of pt.children) if (!list.includes(c)) list.push(c)
    inner.set(n, list)
    forkMap.set(pt.parentId, inner)
  }
  const childrenAt = (id: string, n: number): string[] => forkMap.get(id)?.get(n) ?? []

  // childId -> { parentId, n }（child 只 fork 一次，取第一条）
  const parentInfo = new Map<string, { parentId: string; n: number }>()
  for (const [pid, inner] of forkMap) {
    for (const [n, cs] of inner) {
      for (const c of cs) if (!parentInfo.has(c)) parentInfo.set(c, { parentId: pid, n })
    }
  }

  // 链头：沿「同位置被编辑」链一路上溯（A←B←C 的 A）
  const chainHead = (start: string, n: number): string => {
    let cur = start
    const seen = new Set<string>([start])
    for (;;) {
      const info = parentInfo.get(cur)
      if (!info || info.n !== n || seen.has(info.parentId)) return cur
      seen.add(info.parentId)
      cur = info.parentId
    }
  }

  // 从链头向下按编辑链收集（同位置）
  const collect = (head: string, n: number): string[] => {
    const out = [head]
    const queue = [head]
    const seen = new Set<string>([head])
    while (queue.length) {
      const cur = queue.shift()!
      for (const c of childrenAt(cur, n)) {
        if (seen.has(c)) continue
        seen.add(c)
        out.push(c)
        queue.push(c)
      }
    }
    return out
  }

  // 全部组（按 链头|位置 去重）
  const groups = new Map<string, { n: number; members: string[] }>()
  for (const [pid, inner] of forkMap) {
    for (const [n] of inner) {
      const head = chainHead(pid, n)
      const key = head + '|' + n
      if (!groups.has(key)) groups.set(key, { n, members: collect(head, n) })
    }
  }

  const out: PagerGroup[] = []
  for (const { n, members } of groups.values()) {
    if (!members.includes(currentId)) continue
    const userOrdinal = ordinalOf.get(n)
    if (userOrdinal === undefined) continue // 服务端没算出位置：宁可不画，不画错位置
    // 已删会话过滤掉（组的结构仍按全图算，删中间一条不会把组切两半）
    const alive = members.filter((id) => byId.has(id))
    if (!alive.includes(currentId)) continue
    const items: BranchNavItem[] = alive.map((id) => ({
      id,
      label: id === currentId ? '\u5f53\u524d' : byId.get(id)!.title.trim().slice(0, 24) || '\u5206\u652f',
    }))
    const index = items.findIndex((x) => x.id === currentId)
    const safe = index < 0 ? 0 : index
    out.push({ at: n, userOrdinal, items, index: safe, position: safe + 1, total: items.length })
  }
  return out.sort((a, b) => a.userOrdinal - b.userOrdinal)
}

/**
 * 分页器 -> 渲染锚点（跟随消息的定位，纯函数便于单测）。
 *
 * 锚点 = 该用户消息**整块回复**的最后一条 turn 的 id：
 * 分页器渲染在它之后（下一条用户消息之前 / 列表末尾）。
 * 返回 turnId -> PagerGroup；定位不出来的分页器跳过（宁可不画，不画错位置）。
 */
export function pagerAnchors<T extends { id: string; kind: string }>(turns: T[], pagers: PagerGroup[]): Map<string, PagerGroup> {
  const map = new Map<string, PagerGroup>()
  if (!pagers.length) return map
  const userIdx: number[] = []
  turns.forEach((t, i) => { if (t.kind === 'user') userIdx.push(i) })
  for (const p of pagers) {
    const k = p.userOrdinal
    /**
     * k 越界不再一律丢弃（切模型分页消失的根因，2026-10-11）：
     * 切模型的分叉点在**转录末尾** —— root 会话只有 1 条用户消息（userOrdinal=1），
     * 旧判据 k >= userIdx.length 直接 continue，分页器整个消失（真机："返回后分页不见"）。
     * k === userIdx.length 意为「分叉点在最后一条用户消息之后」＝切模型：
     * 锚到最后一条 turn（对话末尾），分页器照样显示、可切回其它模型分支。
     * k > userIdx.length 才是真越界（数据错位），丢弃。
     */
    if (k < 0 || k > userIdx.length) continue
    const end = k + 1 < userIdx.length ? userIdx[k + 1] - 1 : turns.length - 1
    const anchor = turns[end]?.id
    if (anchor) map.set(anchor, p)
  }
  return map
}
