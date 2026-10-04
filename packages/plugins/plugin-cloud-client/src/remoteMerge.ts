/**
 * remoteMerge —— 「AI 改了云端，本地该怎么跟着变」的纯函数决策层。
 *
 * ## 为什么不能用「整包覆盖」
 *
 * 最省事的做法是收到通知就把云端那份 replaceAll 进本地 —— 这在「服务器是唯一权威、
 * 前端只是显示器」的架构里没问题，但本插件不是那个架构：**前端才是用户正在操作的地方**。
 * 整包覆盖会：
 *   - 冲掉用户刚建、还没推上去的节点；
 *   - 把用户正在输入的文本换回旧值（打字打到一半被换掉）。
 *
 * ## 做法：三方合并
 *
 * 每次同步后记住「云端那份长什么样」（base），下次收到变化时比三个版本：
 *
 *   base   我上次同步时的样子（= 上次云端的状态）
 *   mine   本地现在
 *   theirs 云端现在
 *
 * 逐个 id 判断，谁改的谁说了算：
 *
 * | 情况 | 结果 |
 * |---|---|
 * | 云端改了、本地没动 | 用云端的（AI 的改动落到画面上） |
 * | 云端改了、本地也改了 | 按字段合：只把云端**变过**的字段盖过来，其余保留本地 |
 * | 云端删了、本地没动 | 本地也删 |
 * | 云端删了、本地改过 | 保留本地（然后会被推回去，总比丢掉用户编辑好） |
 * | 本地新增（云端没有） | 保留，绝不删 |
 * | 两边都没动 | 不产生任何操作（保证「没变化就不打扰」） |
 *
 * 最后一条尤其重要：如果没改动也产出一堆 update，会和本地保存互相触发形成回环。
 *
 * 本模块是纯函数、零依赖（与 keys.ts 同理：插件要打成自包含 ESM，不能 import 工作区包）。
 * 类型就地声明成最小结构，不去 import canvas-data 的 CanvasNode。
 */

/**
 * 合并只认这几个字段。
 *
 * 注意 data 是**整体比较**的：data 里任何 key（包括插件写的运行期字段）变了都算「这个节点变了」。
 * 这是有意的保守取舍 —— 认不出「哪个 key 是运行期瞬态」，就宁可多同步一次，
 * 也不要因为漏判而让 AI 的改动同步不到本地。代价是运行期字段变化会多跑一轮合并。
 */
export interface MergeNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: Record<string, unknown>
  parentId?: string
  size?: { w: number; h: number }
}

/** 合并只看这几个字段 */
export interface MergeEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  type?: string
  data?: Record<string, unknown>
}

export interface CanvasGraphSnapshot {
  nodes: MergeNode[]
  edges: MergeEdge[]
}

/** 一次同步要执行的动作（由调用方用 graph 的 API 落实，本模块不碰数据） */
export interface RemoteMergePlan {
  /** 云端新增的节点（本地没有） */
  addNodes: MergeNode[]
  /** 该从本地删掉的节点 id（云端删了且本地没动过） */
  removeNodeIds: string[]
  /** 该覆盖到本地的节点（云端改了；含按字段合并后的结果） */
  updateNodes: MergeNode[]
  addEdges: MergeEdge[]
  removeEdgeIds: string[]
  updateEdges: MergeEdge[]
}

/**
 * 稳定序列化：对象 key 排序后再转字符串。
 * 直接 JSON.stringify 会被 key 顺序骗到（同一份数据换个顺序就判成「变了」），
 * 于是「没变化」被误判成「有变化」→ 无谓的写回 → 回环。
 */
function stable(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}'
}

function sameNode(a: MergeNode | undefined, b: MergeNode | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.type === b.type &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    stable(a.data) === stable(b.data) &&
    stable(a.parentId ?? null) === stable(b.parentId ?? null) &&
    stable(a.size ?? null) === stable(b.size ?? null)
  )
}

function sameEdge(a: MergeEdge | undefined, b: MergeEdge | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.source === b.source &&
    a.target === b.target &&
    (a.sourceHandle ?? '') === (b.sourceHandle ?? '') &&
    (a.targetHandle ?? '') === (b.targetHandle ?? '') &&
    stable(a.type ?? null) === stable(b.type ?? null) &&
    stable(a.data ?? null) === stable(b.data ?? null)
  )
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>()
  for (const item of list) m.set(item.id, item)
  return m
}

/**
 * 两边都改过同一个节点时按字段合：只把云端**确实变过**的字段盖过来。
 * 用户正在拖位置、AI 在改内容 —— 这种「各改各的字段」是最常见的情形，字段级合并能让两者都活下来。
 */
function mergeNodeFields(base: MergeNode, mine: MergeNode, theirs: MergeNode): MergeNode {
  const out: MergeNode = { ...mine, position: { ...mine.position }, data: { ...mine.data } }
  if (base.position.x !== theirs.position.x || base.position.y !== theirs.position.y) {
    out.position = { x: theirs.position.x, y: theirs.position.y }
  }
  // data 逐 key 比对：云端改过的 key 用云端的，没动过的 key 保留本地
  for (const key of Object.keys(theirs.data)) {
    if (stable(theirs.data[key]) !== stable(base.data[key])) out.data[key] = theirs.data[key]
  }
  // 有意**不删** data 里云端没有的 key —— 虽然「云端删了某字段」看起来该跟着删，但落不到本地：
  // 数据层的 updateNode 对 data 是浅合并（packages/canvas-data 的 nodeStore.applyPatch），
  // 没有「按 key 删除」的表达方式。合并产出一个删不掉的结果，只会让本地与云端静默不一致
  // （不报错、不重试，谁也发现不了）。所以这里保持「只增改、不删」这个本地真能做到的语义。
  //
  // ⚠️ 这条是**已知会漏**的限制，别当成「不会发生」（审查时被指出过，这里如实记下）：
  //   - 用户在另一台机器上装插件时走的是 `graph.replaceAll`（整体替换、不是浅合并），
  //     云端那份若少了某 key，装一次插件本地就跟着少；
  //   - 用户把画布删光再让 AI 加回同 id 的节点，云端那份没有老 key，本地还留着；
  //   - AI 用 MCP 传的 data 是**整个 data 对象**（canvasDoc 里是 `node.data = a.data`，不是浅合并），
  //     它不写某个 key 就等于云端少了那个 key；
  //   - 同一账号开多个标签页时，各页各自维护基准，A 页删掉的 key 在 B 页看来仍是「本地有」。
  // 要根治得让落地侧支持「字段级删除」（数据层 updateNode 目前表达不了）。当前取舍是：
  // 宁可漏同步删除，也不要产出落不下去的合并结果造成静默漂移。
  // 同一条限制在 remoteSync 的文件头也记了一笔，改的时候两边要一起看。
  if (stable(base.parentId ?? null) !== stable(theirs.parentId ?? null)) {
    // 只认「云端给了一个新的父」；云端没有父时保持本地不动（同上：本地表达不了「解除」）
    if (theirs.parentId !== undefined) out.parentId = theirs.parentId
  }
  if (stable(base.size ?? null) !== stable(theirs.size ?? null)) {
    if (theirs.size !== undefined) out.size = { ...theirs.size }
  }
  return out
}

/**
 * 算一次「把云端的变化落到本地」的动作清单。
 *
 * @param base   上次同步后记下的云端状态（没有则传空快照 = 把云端当全新增）
 * @param mine   本地当前状态
 * @param theirs 云端当前状态
 * @param knownType 本地认不认识某个节点类型（不给 = 全认）。不认识的类型当作「云端没有」：
 *                  它是本地渲染不了的节点，加进来只会是空白/报错，不如不加。
 */
export function planRemoteMerge(
  base: CanvasGraphSnapshot,
  mine: CanvasGraphSnapshot,
  theirs: CanvasGraphSnapshot,
  knownType: (type: string) => boolean = () => true,
): RemoteMergePlan {
  const plan: RemoteMergePlan = {
    addNodes: [],
    removeNodeIds: [],
    updateNodes: [],
    addEdges: [],
    removeEdgeIds: [],
    updateEdges: [],
  }
  const baseNodes = byId(base.nodes)
  const mineNodes = byId(mine.nodes)
  const theirsNodes = byId(theirs.nodes)

  for (const [id, t] of theirsNodes) {
    const b = baseNodes.get(id)
    const m = mineNodes.get(id)
    if (!b) {
      // 云端新增：本地没有才加（本地已有同 id 视为本地的东西，不覆盖）
      if (!m && knownType(t.type)) plan.addNodes.push({ ...t, position: { ...t.position }, data: { ...t.data } })
      continue
    }
    if (sameNode(b, t)) continue // 云端没动这个节点
    if (!m) continue // 本地没有（本地删过）→ 尊重本地删除，不复活
    if (!knownType(t.type)) continue // 本地不认识这个类型 → 不试图改它
    if (sameNode(b, m)) {
      // 只有云端改了：整份用云端的
      plan.updateNodes.push({ ...t, position: { ...t.position }, data: { ...t.data } })
    } else {
      // 两边都改过：按字段合（各自改的字段都保住）
      const merged = mergeNodeFields(b, m, t)
      if (!sameNode(merged, m)) plan.updateNodes.push(merged)
    }
  }

  for (const [id, b] of baseNodes) {
    if (theirsNodes.has(id)) continue
    const m = mineNodes.get(id)
    if (!m) continue // 本地早就删了，不用再删
    if (sameNode(b, m)) plan.removeNodeIds.push(id) // 本地没动 → 跟着云端删
    // 本地改过 → 保留（宁可多留一个，也不丢用户编辑）
  }

  // —— 边 ——
  const baseEdges = byId(base.edges)
  const mineEdges = byId(mine.edges)
  const theirsEdges = byId(theirs.edges)
  const removedNodes = new Set(plan.removeNodeIds)
  // 合并之后本地还剩哪些节点：用于挡掉「端点不存在」的悬挂边
  const aliveNodeIds = new Set<string>()
  for (const id of mineNodes.keys()) if (!removedNodes.has(id)) aliveNodeIds.add(id)
  for (const n of plan.addNodes) aliveNodeIds.add(n.id)

  for (const [id, t] of theirsEdges) {
    const b = baseEdges.get(id)
    const m = mineEdges.get(id)
    if (!b) {
      if (!m && aliveNodeIds.has(t.source) && aliveNodeIds.has(t.target)) {
        plan.addEdges.push({ ...t })
      }
      continue
    }
    if (sameEdge(b, t)) continue
    if (!m) continue
    // 只有「本地没动过」才用云端的版本；两边都改了则保留本地 —— 边没有 field 级合并的余量
    // （源/目标/端口是一个整体，各改一半没有意义）。这条取舍与节点不同，是有意的。
    // 顺带：更新也要挡住悬挂边（端点得在合并之后的本地画布里存在），与新增同样的检查。
    if (sameEdge(b, m) && aliveNodeIds.has(t.source) && aliveNodeIds.has(t.target)) {
      plan.updateEdges.push({ ...t })
    }
  }

  // 云端删掉的边，以及「节点被删导致失效」的边，本地也要清掉
  for (const [id, b] of baseEdges) {
    if (theirsEdges.has(id)) continue
    const m = mineEdges.get(id)
    if (m && sameEdge(b, m)) plan.removeEdgeIds.push(id)
  }
  for (const [id, m] of mineEdges) {
    if (plan.removeEdgeIds.includes(id)) continue
    if (removedNodes.has(m.source) || removedNodes.has(m.target)) {
      if (!plan.removeEdgeIds.includes(id)) plan.removeEdgeIds.push(id)
    }
  }

  return plan
}

/** 计划里有没有实际要干的事（没变化 → 完全不碰本地数据） */
export function isPlanEmpty(plan: RemoteMergePlan): boolean {
  return (
    plan.addNodes.length === 0 &&
    plan.removeNodeIds.length === 0 &&
    plan.updateNodes.length === 0 &&
    plan.addEdges.length === 0 &&
    plan.removeEdgeIds.length === 0 &&
    plan.updateEdges.length === 0
  )
}
