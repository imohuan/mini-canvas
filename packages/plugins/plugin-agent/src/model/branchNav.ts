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
  /**
   * 这些子会话只有「分叉时拷走的前缀」、没有一条自己的新回合 —— 旧版「点模型就建分支」
   * 留下的幽灵版本（用户 2026-11-14：同一栏里叠出两个分页器）。
   * 由服务端按转录长度判定（子会话回合数 ≤ 分叉点下标）。
   */
  ghosts?: string[]
  /**
   * 分叉点落在父转录**末尾**（该位置没有用户消息）= 切模型留下的分支。
   *
   * 结构性判据（不靠猜）：编辑重发一定 fork 在**某条用户消息之前**（点 < 回合数），
   * 只有换模型才在末尾开一条同样的会话。用户 2026-11-14 口径：这类分支要**覆盖**当前分支，
   * 不该多出一个版本。由服务端按父转录长度判定。
   */
  tail?: boolean
}

/** 'turn:3' -> 3；解析不出返回 null（老数据 / 未来格式） */
function parseTurnPoint(point: string): number | null {
  const m = /^turn:(\d+)$/.exec(point)
  return m ? Number(m[1]) : null
}

/**
 * 折叠幽灵版本：把 ghost 子会话的分叉点搬到它的上级会话上，并把 ghost 从版本组里摘掉。
 *
 * 为什么可以原地搬（不做任何内容改写）：幽灵会话的转录就是父会话的前缀拷贝，
 * 所以「在 ghost 的第 m 条之前分叉」与「在父会话的第 m 条之前分叉」是同一个位置。
 * 折叠之后 `root→v2(幽灵)→v3` 变成 `root→v3`，分组回到「一处一行」，
 * 而 v3 仍然可达（用户不会因为清理而丢掉真正的分支）。
 */
/** 某个会话一路向上折到的**实体**版本（不是幽灵就是它自己）。 */
/**
 * 切模型留下的「末尾分叉」：子会话 -> 它接替的那条会话。
 *
 * 这类分叉不该算一个版本（末尾没有用户消息，画不出页码），但子会话本身是**当前内容**：
 * 它要能继续看到自己所属的那一版，并在那一版上显示「当前」。所以它不是被删掉，
 * 而是像幽灵一样**折进父会话**。
 */
export function tailFolds(points: ForkPoint[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const p of points) {
    if (!p.tail) continue
    for (const c of p.children) if (!map.has(c)) map.set(c, p.parentId)
  }
  return map
}

export function foldGhostId(id: string, points: ForkPoint[]): string {
  const ghosts = new Set<string>()
  const parentOf = new Map<string, string>()
  for (const p of points) {
    for (const g of p.ghosts ?? []) ghosts.add(g)
    for (const c of p.children) if (!parentOf.has(c)) parentOf.set(c, p.parentId)
  }
  // 切模型的末尾分叉同样是「我接替了它」：停在上面时按父版本认位置
  for (const [child, parent] of tailFolds(points)) {
    ghosts.add(child)
    if (!parentOf.has(child)) parentOf.set(child, parent)
  }
  let cur = id
  const seen = new Set<string>([cur])
  while (ghosts.has(cur)) {
    const up = parentOf.get(cur)
    if (!up || seen.has(up)) return cur
    seen.add(up)
    cur = up
  }
  return cur
}

export function contractGhosts(points: ForkPoint[]): ForkPoint[] {
  const ghosts = new Set<string>()
  for (const p of points) for (const g of p.ghosts ?? []) ghosts.add(g)
  /**
   * 切模型留在末尾的那些子会话也一并折掉（用户 2026-11-14 口径：它该覆盖当前分支）。
   *
   * 折法与幽灵相同：它自己被摘出版本组，下游分叉点改挂到它接替的那条会话上。
   */
  const tails = tailFolds(points)
  for (const child of tails.keys()) ghosts.add(child)
  if (!ghosts.size) return points
  const folded = points
  /** ghost -> 它的父会话（取第一条记录，与 parentMap 同一口径） */
  const parentOf = new Map<string, string>()
  for (const p of folded) for (const c of p.children) if (ghosts.has(c) && !parentOf.has(c)) parentOf.set(c, p.parentId)
  /** 一路向上找到第一个不是 ghost 的祖先（模型连切几次会串成一条 ghost 链） */
  const solidOf = (id: string): string => {
    let cur = id
    const seen = new Set<string>([cur])
    while (ghosts.has(cur)) {
      const up = parentOf.get(cur)
      if (!up || seen.has(up)) return cur
      seen.add(up)
      cur = up
    }
    return cur
  }
  /** 同一 (父, 位置) 合并成一条，children 去重合并 */
  const merged = new Map<string, ForkPoint>()
  for (const p of folded) {
    const parentId = solidOf(p.parentId)
    const children = p.children.filter((c) => !ghosts.has(c))
    if (!children.length) continue
    const key = parentId + '|' + p.point
    const prev = merged.get(key)
    if (prev) {
      for (const c of children) if (!prev.children.includes(c)) prev.children.push(c)
      if (prev.userOrdinal === undefined && p.userOrdinal !== undefined) prev.userOrdinal = p.userOrdinal
      continue
    }
    merged.set(key, { ...p, parentId, children: [...children], ghosts: undefined })
  }
  return [...merged.values()]
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
  pointsIn: ForkPoint[],
): PagerGroup[] {
  // 先把旧版留下的幽灵版本折回父会话，再算组（否则同一处会画出两三行一模一样的页码）
  const points = contractGhosts(pointsIn)
  /**
   * 当前这一屏可能**就是一条幽灵会话**（用户点历史列表或旧链接直接进来的）。
   * 折叠后它已不在任何组里，但用户眼前确实是一份"和某一版一样"的内容 ——
   * 直接不画分页器会让他回不去（2026-11-14 实测：切到幽灵版本后分页器整个消失）。
   * 所以把"自己"当成它折进去的那个实体版本来认位置。
   */
  const self = foldGhostId(currentId, pointsIn)
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
    const mine = members.includes(currentId) ? currentId : self
    if (!members.includes(mine)) continue
    // 组的 userOrdinal 取「当前会话自己的父」那份（同一 N 在不同父下可能不同）
    /**
     * 序号按**这一组的父**取（同一 turn:N 在不同父会话下可能不同，只按 N 缓存会错位）。
     * 取不到就丢弃（宁可不画，不画错位置）。
     */
    const userOrdinal = ordinalOf.get(ordinalKey(owner, n))
    if (userOrdinal === undefined) continue // 服务端没算出位置：宁可不画，不画错位置
    // 已删会话过滤掉（组的结构仍按全图算，删中间一条不会把组切两半）
    const alive = members.filter((id) => byId.has(id))
    if (!alive.includes(mine)) continue
    // 只剩自己一个版本就别画了：`1 / 1` 两枚箭头全灰，纯占地方（删掉其它版本后会这样）
    if (alive.length < 2) continue
    const items: BranchNavItem[] = alive.map((id) => ({
      id,
      // 「当前」标在**实体版本**上；幽灵会话看到的也是那一条（内容一模一样）
      label: id === mine ? '\u5f53\u524d' : byId.get(id)!.title.trim().slice(0, 24) || '\u5206\u652f',
    }))
    const index = items.findIndex((x) => x.id === mine)
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
    /**
     * k = 「分叉点之前已经聊过几轮」（服务端按父转录数出来的用户消息条数）。
     *
     * 早年这里把 k 当成「第几条用户消息的下标」，于是锚点整体往后错一轮：
     * 在 branch1 继续聊到第二轮之后，分页器还赖在列表最底下，看起来像"分支挂在最后一轮"。
     * 用户 2026-11-14 明确口径：第一轮有分支、第二轮没有 → 分页器应停在第一轮的回复下面。
     *   ① k === 0：分叉点在**第一条用户消息之前**（编辑第一句）→ 挂在**第一轮回复之后**。
     *      不能挂列表最上面（用户 2026-11-14 截图：分页跑到了用户消息上方，像与对话无关）；
     *      分页器永远属于「某一轮 AI 回复」，第一轮的分支就画在第一轮回复下面。
     *   ② 0 < k < 用户消息数：挂在「第 k 条用户消息」之前 = 第 k 轮回复块的末尾；
     *   ③ k === 用户消息数：分叉点在末尾（切模型/末尾开分支）→ 挂在列表末尾；
     *   ④ k > 用户消息数：数据错位，丢弃（宁可不画，不画错位置）。
     */
    const k = p.userOrdinal
    let endIdx: number
    if (k === 0) endIdx = userIdx.length > 1 ? userIdx[1] - 1 : turns.length - 1
    else if (k < userIdx.length) endIdx = userIdx[k] - 1
    else if (k === userIdx.length) endIdx = turns.length - 1
    else continue
    const anchor = turns[endIdx]?.id
    if (!anchor) continue
    const list = map.get(anchor) ?? []
    list.push(p)
    map.set(anchor, list)
  }
  return map
}
