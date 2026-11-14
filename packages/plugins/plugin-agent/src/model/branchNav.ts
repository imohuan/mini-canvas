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
  /**
   * 「父会话 + 位置」→ userOrdinal。
   *
   * 不能只按 N 缓存（独立复查指出）：不同父会话的转录长短不同，同一个 turn:N 数出来的
   * 用户消息序号可以不一样；只留第一份会让后面那组的锚点错位。
   */
  const ordinalOf = new Map<string, number>()
  const ordinalKey = (parentId: string, n: number): string => parentId + '|' + n
  for (const pt of points) {
    const n = parseTurnPoint(pt.point)
    if (n === null) continue
    if (pt.userOrdinal !== undefined && !ordinalOf.has(ordinalKey(pt.parentId, n))) {
      ordinalOf.set(ordinalKey(pt.parentId, n), pt.userOrdinal)
    }
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

  // 全部组（按 链头|位置 去重）；owner = 链头被分出来的那个父会话（取 userOrdinal 用）
  const groups = new Map<string, { n: number; members: string[]; owner: string }>()
  for (const [pid, inner] of forkMap) {
    for (const [n] of inner) {
      const head = chainHead(pid, n)
      const key = head + '|' + n
      if (!groups.has(key)) {
        const headParent = parentInfo.get(head)
        groups.set(key, { n, members: collect(head, n), owner: headParent && headParent.n === n ? headParent.parentId : pid })
      }
    }
  }

  const out: PagerGroup[] = []
  for (const { n, members, owner } of groups.values()) {
    /**
     * **只画当前版本自己确实在其中**的那一组。
     *
     * 曾经试过「沿祖先链放宽」（让下游版本也能看到上游那组），独立复查指出：那样 v3 会画出
     * root→v2 那组，而 v3 并不在其中，页码只能钳成 1/2，点箭头会跳到**另一条分支**上 ——
     * 页码与内容反而对不上，正是用户报的现象。所以范围回到“成员包含当前会话”。
     *
     * 链式分叉下每个版本看到的是**自己所在的那一组**；同一位置可能有多组（见 pagerAnchors），
     * 界面按位置逐行渲染，不会互相覆盖。
     */
    if (!members.includes(currentId)) continue
    // 组的 userOrdinal 取「当前会话自己的父」那份（同一 N 在不同父下可能不同）
    /**
     * 序号按**这一组的父**取（同一 turn:N 在不同父会话下可能不同，只按 N 缓存会错位）。
     * 取不到就丢弃（宁可不画，不画错位置）。
     */
    const userOrdinal = ordinalOf.get(ordinalKey(owner, n))
    if (userOrdinal === undefined) continue // 服务端没算出位置：宁可不画，不画错位置
    // 已删会话过滤掉（组的结构仍按全图算，删中间一条不会把组切两半）
    const alive = members.filter((id) => byId.has(id))
    if (!alive.includes(currentId)) continue
    const items: BranchNavItem[] = alive.map((id) => ({
      id,
      label: id === currentId ? '\u5f53\u524d' : byId.get(id)!.title.trim().slice(0, 24) || '\u5206\u652f',
    }))
    const index = items.findIndex((x) => x.id === currentId)
    if (index < 0) continue
    const safe = index
    out.push({ at: n, userOrdinal, items, index: safe, position: safe + 1, total: items.length })
  }
  /**
   * 多个分页器的先后：按**落在第几条用户消息之后**排（userOrdinal 小者在前），
   * 同一位置再按转录下标兜底。
   *
   * 不要只按 at：at 是「父会话里的 turn 下标」，不同分叉点的父不同、量纲不一样
   * （真实数据 root|turn:2 与 v2|turn:0 同时存在，按 at 会把后面的分页器画到前面）。
   */
  return out.sort((a, b) => a.userOrdinal - b.userOrdinal || a.at - b.at)
}

/**
 * 分页器 -> 渲染锚点（跟随消息的定位，纯函数便于单测）。
 *
 * 锚点 = 该用户消息**整块回复**的最后一条 turn 的 id：
 * 分页器渲染在它之后（下一条用户消息之前 / 列表末尾）。
 * **同一位置可以有多组**（链式分叉的真实形态）。
 *
 * 为什么不能只返回一组（用户 2026-11-14 截图：页码 2/2、消息却已经是上一版）：
 * 链式分叉时 root→v2（分叉点 turn:2）与 v2→v3（turn:0）落在同一个回复块之后，
 * 用 Map<turnId, PagerGroup> 存，后写的把前一组覆盖掉 —— 界面于是只画得出其中一组，
 * 页码与内容对不上，且必须再点一次才“跳”。改为按位置聚合数组：有几组就画几行。
 */
export function pagerAnchors<T extends { id: string; kind: string }>(turns: T[], pagers: PagerGroup[]): Map<string, PagerGroup[]> {
  const map = new Map<string, PagerGroup[]>()
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
    if (!anchor) continue
    const list = map.get(anchor) ?? []
    list.push(p)
    map.set(anchor, list)
  }
  return map
}
