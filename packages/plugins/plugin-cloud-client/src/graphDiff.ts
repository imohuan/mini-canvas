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
    else if (stable(before) !== stable(item)) ops.update.push(item)
  }
  for (const id of baseIdx.keys()) {
    if (!mineIdx.has(id)) ops.delete.push(id)
  }
  return ops
}

/** 这份增量里有没有要干的事（没有就别发请求） */
export function isEmptyOps(ops: GraphOps): boolean {
  return ops.add.length === 0 && ops.delete.length === 0 && ops.update.length === 0
}

