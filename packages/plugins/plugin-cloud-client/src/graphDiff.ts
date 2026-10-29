/**
 * graphDiff —— 把「我这份完整画布」与「上次提交的那份」比出增量（纯函数）。
 *
 * ## 为什么要 diff
 *
 * 网页端保存的语义是「以我这份为准」——它手上就是整张画布的全量。若直接 PUT 整份，
 * 就会把**另一个写方（AI）在两次提交之间做的改动整个盖掉**（AI 刚加的节点凭空消失）。
 *
 * 改成只提交「变了什么」之后：我这次没提到的节点，服务端原样留着，谁都不覆盖谁。
 *
 * ## base 为什么用「上次提交的内容」而不是「服务端当时的内容」
 *
 * 因为网页端这份数据已经含了 AI 的改动了 —— 实时通道（remoteSync）会把云端的变化合进本地。
 * 于是「上次提交」与「本次提交」之间的差异，正好等于「本地真正改了的东西」：
 * AI 加的节点早在本地这份里，不会出现在 diff 里，也就不会被当成「要删」。
 *
 * ## 认不出的东西宁可当「没变」
 *
 * id 不是字符串、内容不是对象的条目一律跳过（交给服务端原有的形状校验）。
 * 在这里猜错方向的代价是删掉别人的数据，比「少改一次」严重得多。
 */

/** 一条增量的三段式（与 MCP 的 batch 工具同形状） */
export interface GraphOps {
  add: unknown[]
  delete: string[]
  update: unknown[]
}

/** 稳定序列化：对象 key 排序后再比，避免「同一份数据换个 key 顺序」被判成「变了」 */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}'
}

function idOf(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined
  const id = (item as { id?: unknown }).id
  return typeof id === 'string' && id ? id : undefined
}

function indexById(list: unknown): Map<string, unknown> {
  const m = new Map<string, unknown>()
  if (!Array.isArray(list)) return m
  for (const item of list) {
    const id = idOf(item)
    if (id) m.set(id, item)
  }
  return m
}

/**
 * 算出「从 base 到 mine」要执行的增删改。
 *
 * base 传 undefined/非数组 = 没有基准（首次提交）：此时全当新增，不做任何删除。
 * 这条对「第一次上云」很重要 —— 把本地这份原样推上去，而不是先删光再建。
 */
export function diffGraph(base: unknown, mine: unknown): GraphOps {
  const ops: GraphOps = { add: [], delete: [], update: [] }
  if (!Array.isArray(mine)) return ops
  // 首次提交（还没有基准）→ 全新增。不是「先删后加」：那样中间态会被别的写方看到。
  if (!Array.isArray(base)) {
    ops.add = mine.filter((item) => idOf(item) !== undefined)
    return ops
  }
  const baseIdx = indexById(base)
  const mineIdx = indexById(mine)
  for (const [id, item] of mineIdx) {
    const before = baseIdx.get(id)
    if (before === undefined) ops.add.push(item)
    else if (stable(before) !== stable(item)) {
      const entry = withExplicitParentRemoval(item, before)
      // 本地这份 data 里已经没有、而服务器基准里还有的键：浅合并表达不了「删除」
      // （对象缺 key = 服务端按「这次没提」处理）。用显式 dataUnset 补上 —— 服务端
      // batchNodes 的 update 分支已支持（与 MCP 同一条通道）。
      const unset = removedDataKeys(before, item)
      const patched = unset.length > 0 ? { ...(entry as Record<string, unknown>), dataUnset: unset } : entry
      ops.update.push(patched)
    }
  }
  for (const id of baseIdx.keys()) {
    if (!mineIdx.has(id)) ops.delete.push(id)
  }
  return ops
}

/**
 * 把「本地已没有 parentId、服务器那份还有」的节点补成显式 `parentId: null`。
 *
 * 为什么必须补（真 bug，2026-10-08 实测）：服务端把「对象里没有这个 key」读成
 * **「这次没提这个字段」**（见 canvasDocument.batchNodes 的注释），只有显式给 `null`
 * 才执行 `delete node.parentId`。而本地节点出组后就是**不存在这个 key**（JS 里是 undefined，
 * JSON 序列化时整个丢掉）—— 于是「把节点拖出分组 / 解散分组」写上去等于没写：
 * 刷新一看节点又回到组里；组被删掉时还会留下指向已删组的悬挂 parentId。
 *
 * 只对 parentId 这一条做（它是服务端唯一支持 null 清除语义的字段）；别的字段少 key
 * 仍按「没提」处理，不给服务器塞一堆字面 null。
 */
function withExplicitParentRemoval(item: unknown, before: unknown): unknown {
  if (!item || typeof item !== 'object') return item
  const hadParent = typeof (before as { parentId?: unknown } | undefined)?.parentId === 'string'
  const hasParent = typeof (item as { parentId?: unknown }).parentId === 'string'
  if (!hadParent || hasParent) return item
  return { ...(item as Record<string, unknown>), parentId: null }
}

/**
 * 「本地 data 已没有、服务器基准里还有」的键 —— 保存时必须显式声明删除。
 * 判据只用基准（服务器那份）与本地这份：本地是权威（保存语义 = 以我为准）。
 */
function removedDataKeys(before: unknown, mine: unknown): string[] {
  if (!before || typeof before !== 'object' || !mine || typeof mine !== 'object') return []
  const beforeData = (before as { data?: unknown }).data
  const mineData = (mine as { data?: unknown }).data
  if (!beforeData || typeof beforeData !== 'object') return []
  if (!mineData || typeof mineData !== 'object') return []
  const out: string[] = []
  for (const key of Object.keys(beforeData as Record<string, unknown>)) {
    if (!(key in (mineData as Record<string, unknown>))) out.push(key)
  }
  return out
}

/** 这份增量里有没有要干的事（没有就别发请求） */
export function isEmptyOps(ops: GraphOps): boolean {
  return ops.add.length === 0 && ops.delete.length === 0 && ops.update.length === 0
}
