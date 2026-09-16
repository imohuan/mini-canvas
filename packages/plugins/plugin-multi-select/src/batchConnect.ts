/**
 * batchConnect —— 多选"批量连线"的纯逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 复刻 v1 `useCanvasConnection` 的批量连线（`onSelectionBatchConnectStart` / `onBatchConnectEnd`）：
 * 按住多选框左右两侧的圆形端口拖动 → 拖出一条临时连线（带一个临时节点跟着鼠标）→
 * 松手落在某个节点上 → **给选中集里的每个节点各建一条边**连到那个目标。
 * 松手在空白处 / 中途取消 → 什么都不建。
 *
 * 为什么把"往哪个方向连、连哪些节点、要不要提示非法"这些判断单独抽出来：
 * 它们是这块功能里唯一有分支的逻辑（左右两侧方向相反、成环要拦、已连过的要跳过），
 * 放在组件里只能靠手点验证；抽出来就能直接断言。
 *
 * 方向语义（对齐 v2 内核 connection 的 canonical 约定：sourceHandle 恒在输出端）：
 * - **右侧端口**（type='source'）：选中节点作为**源**，连到目标的输入口（拖线向右）。
 * - **左侧端口**（type='target'）：选中节点作为**目标**，从源的输出口连进来（拖线向左）。
 * 两侧最终都落到同一条 canonical 边上，只是谁当 source 谁当 target 不同。
 */

/** 拖动哪一侧的端口 */
export type BatchSide = 'source' | 'target'

/**
 * 这次节点拖动要不要让多选框跟随。
 *
 * 用户报的 bug："我拖拽未选中的节点的时候你的这个选框也在移动"。
 * 选框代表的是**选中集**的包围盒，只有被拖的节点本身就在选中集里，框才该跟着走；
 * 拖一个没选中的节点时框应当纹丝不动。
 *
 * @param draggedNodeId 本次被拖动的节点 id
 * @param selectedIds 当前选中集
 */
export function shouldFrameFollowDrag(
  draggedNodeId: string,
  selectedIds: ReadonlySet<string>,
): boolean {
  return selectedIds.has(draggedNodeId)
}

/**
 * "框内空白 = 整组平移"这个接管，要不要因为落点命中别的东西而让位。
 *
 * 用户报的 bug："你的多选框的 movinghandler 无法进行拖拽"。
 * 端口球就画在多选框边缘**内侧**，画布层的几何判定会把它算成"框内空白"，
 * 于是这次按下被抢走、端口收不到事件。
 *
 * 注意：这里**不**用 `closest('.moving-handle-anchor')` 作主判据 —— 那个类名是主题的通用端口标记，
 * 节点上的端口也带它；虽然节点端口前面已被 `.vue-flow__node` 拦下，判断仍以"本插件自己的槽"为准更稳。
 *
 * @param hitElements 落点各层命中的元素（由调用方用 closest 探出）
 */
export function isHitOwnBatchPort(hit: {
  batchSlot: boolean
  movingHandle: boolean
}): boolean {
  return hit.batchSlot || hit.movingHandle
}

/** 一条待建的边（canonical：source 端是输出口、target 端是输入口） */
export interface BatchEdgeSpec {
  source: string
  target: string
  sourceHandle: 'source'
  targetHandle: 'target'
}

/** 拖动中"每个选中节点各一条临时线"的端点（flow 坐标） */
export interface BatchGuideLine {
  /** 该线的源节点 id（用来取它自己的端口锚点） */
  nodeId: string
  /** 起点：该节点朝外侧的端口锚点 */
  from: { x: number; y: number }
  /** 终点：鼠标（或吸附到的目标端口） */
  to: { x: number; y: number }
  /** 该源节点朝外的一侧：右侧拖出=right，左侧拖出=left（决定贝塞尔从哪边出） */
  fromPosition: 'left' | 'right'
  /**
   * 松手后这条线**会不会真的连上**（可选：未判定时缺省，渲染层按"未定"处理）。
   *
   * 为什么要它：批量连线里各源的合法性可能**不同**（类型不符 / 目标输入口容量被前面的兄弟占满…），
   * 而所有临时线长得一模一样 —— 用户根本看不出"我这一拖到底会连上几条"。
   * 有这一位就能把连不上的那条画淡/画虚，做到"只允许支持的连接线进行连接"这件事**在拖拽时就可预见**。
   */
  willConnect?: boolean
}

/** 一个矩形（flow 绝对坐标），与 nodeLayout 的 LayoutRect 同形 */
export interface BatchRect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** 渲染层 resolveFeedback 要的矩形（注意是 width/height，不是 w/h） */
export interface FeedbackNodeRect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * nodeLayout 的 { x, y, w, h } → 渲染层 resolveFeedback 要的 { x, y, width, height }。
 *
 * 为什么要单独一个函数：这两套字段名长得像但**不能混用**。少了这一步转换，
 * width/height 是 undefined，几何命中全部算成 NaN，resolveFeedback 的 hover 恒为 null，
 * 于是"拖到目标节点上的 3D 倾斜 / 非法模糊 / 气泡"整套反馈都不会亮
 * （用户报的"拖到目标节点上没有任何效果"就是这个）。
 *
 * 放在这里（纯函数、零 Vue）而不是散在组件里：单测能直接断言"转换后的矩形确实命中得了目标"。
 */
export function toNodeRects(rects: ReadonlyArray<BatchRect>): FeedbackNodeRect[] {
  return rects.map((r) => ({ id: r.id, x: r.x, y: r.y, width: r.w, height: r.h }))
}

/**
 * 生成拖动中的 N 条临时线：**每个选中节点各一条**，从他自己的外侧端口锚点连到鼠标。
 *
 * 用户明确要的就是这个效果："我要的连接线是 从多选中每一个节点 对应端口创建一条连接线到鼠标位置"。
 * 之前只画了一条（从多选框边缘出发），看不出"这一批会连到哪几个节点"。
 *
 * @param side 拖哪一侧：'source'=右侧（各节点作为源、线从右缘出）/'target'=左侧（作为目标、线从左缘出）
 * @param selectedIds 选中节点 id（顺序即线的顺序）
 * @param rects 这些节点的绝对矩形（取自 nodeLayout）
 * @param cursor 鼠标的 flow 坐标（未吸附时所有线都指向它）
 * @param snap 吸附到的目标端口锚点（给了就所有线都指向它）
 */
export function buildBatchGuideLines(
  side: BatchSide,
  selectedIds: Iterable<string>,
  rects: ReadonlyArray<BatchRect>,
  cursor: { x: number; y: number },
  snap?: { x: number; y: number } | null,
): BatchGuideLine[] {
  const byId = new Map(rects.map((r) => [r.id, r]))
  const fromPosition: 'left' | 'right' = side === 'source' ? 'right' : 'left'
  const out: BatchGuideLine[] = []
  for (const id of selectedIds) {
    const r = byId.get(id)
    if (!r) continue // 拿不到矩形的（未渲染/无实测尺寸）不画，不瞎猜位置
    out.push({
      nodeId: id,
      from: {
        x: fromPosition === 'right' ? r.x + r.w : r.x,
        y: r.y + r.h / 2,
      },
      to: snap ?? cursor,
      fromPosition,
    })
  }
  return out
}

/**
 * 把"选中集 + 落点目标"展开成要建的一批边。
 *
 * @param side 从哪一侧拖出：'source'=右侧（选中节点当源），'target'=左侧（选中节点当目标）
 * @param selectedIds 选中节点 id
 * @param dropNodeId 松手落到的目标节点 id（落空白则传 null/undefined）
 * @returns 要建的边列表；落空白或选中集为空时返回空数组
 *
 * 目标若**本身就在选中集里**会被排除：那种"自己连自己"既无意义、又必然被内核判成自连/重复。
 */
export function planBatchEdges(
  side: BatchSide,
  selectedIds: Iterable<string>,
  dropNodeId: string | null | undefined,
): BatchEdgeSpec[] {
  if (!dropNodeId) return []
  const ids = [...selectedIds]
  if (ids.length === 0) return []
  const out: BatchEdgeSpec[] = []
  for (const id of ids) {
    if (id === dropNodeId) continue // 不连自己
    out.push(
      side === 'source'
        ? { source: id, target: dropNodeId, sourceHandle: 'source', targetHandle: 'target' }
        : { source: dropNodeId, target: id, sourceHandle: 'source', targetHandle: 'target' },
    )
  }
  return out
}

/**
 * 一次批量落边后的统计（供 UI 反馈"连了几条 / 跳过了几条"）。
 * @param idempotent 已经有同样的边（内核会幂等跳过）
 * @param rejected 被内核拒（成环/类型不符/输入口已满等）
 */
export interface BatchApplyResult {
  created: number
  idempotent: number
  rejected: number
}

/**
 * 逐条落边的决策（纯函数）：调用方传入"这条边能不能建"的判定，本函数负责计数与跳过。
 * 之所以要它：批量里"一部分成功、一部分被拒"是常态，UI 需要知道到底建了几条，
 * 而这套分类逻辑不该散在组件的 for 循环里。
 *
 * @param specs 待建边
 * @param exists 该边是否已存在（内核幂等语义）
 * @param canConnect 该边是否通过校验（环/类型/容量）
 */
export function summarizeBatchApply(
  specs: ReadonlyArray<BatchEdgeSpec>,
  exists: (spec: BatchEdgeSpec) => boolean,
  canConnect: (spec: BatchEdgeSpec) => boolean,
): BatchApplyResult {
  const out: BatchApplyResult = { created: 0, idempotent: 0, rejected: 0 }
  for (const spec of specs) {
    if (exists(spec)) {
      out.idempotent += 1
      continue
    }
    if (!canConnect(spec)) {
      out.rejected += 1
      continue
    }
    out.created += 1
  }
  return out
}

/** 一批落边的决策结果 */
export interface BatchApplyPlan {
  /** 真正要建的边（按输入顺序） */
  build: BatchEdgeSpec[]
  /** 被拒的边（校验不过：自连 / 成环 / 类型不符 / 容量已满…） */
  rejected: BatchEdgeSpec[]
  /**
   * 已经存在、无需再建的边（内核幂等语义）。
   *
   * 与 rejected 分开：这两者对用户的意义不同 —— "已经有了"松手后那条边照样在，
   * 而"被拒"是真的连不上。临时线据此把后者画淡，前者不能（见 markGuideLines）。
   */
  duplicated: BatchEdgeSpec[]
}

/** 落边判定：给一条候选边，回答"它是不是已经存在"和"它现在能不能建" */
export interface BatchApplyDeciders {
  /** 该边是否已存在于图中（内核幂等语义） */
  isDuplicate(spec: BatchEdgeSpec): boolean
  /**
   * 该边是否通过校验。
   *
   * **关键**：第二个入参是"这一批里**已经决定要建**的边"。调用方必须把它一起喂给校验——
   * 目标输入口容量往往只有 1，若只拿"图上已有的边"判，同一批里的 3 个合法源会**各自都判合法**、
   * 于是 3 条一起落进只装得下 1 条的口（用户说的"不能一股脑的直接建立连接线"就是这个）。
   */
  canConnect(spec: BatchEdgeSpec, alreadyPlanned: ReadonlyArray<BatchEdgeSpec>): boolean
}

/**
 * 批量落边的决策（纯函数）：**逐条**判定、只把合法的挑出来建，不合法的如实记进 rejected。
 *
 * 为什么需要"批内累计"这一层，而不是每条各自查一次图：
 * 容量类规则（目标输入口 capacity）看的是"这个口上已经有多少条入边"。逐条各自查图时，
 * 这一批里**兄弟边**谁都看不见谁 —— 于是一批 3 条全判合法、全落进容量 1 的口。
 * 把已计划的边一并喂进校验，才真正实现"只允许支持的那些连上"。
 *
 * 顺序语义：按输入顺序**先到先得**。目标口只能装 1 条而候选有 3 条时，落第一条、其余判拒 ——
 * 与单条拖线时"先连上的那条占住口"的行为一致。
 */
export function planBatchApply(
  specs: ReadonlyArray<BatchEdgeSpec>,
  deciders: BatchApplyDeciders,
): BatchApplyPlan {
  const build: BatchEdgeSpec[] = []
  const rejected: BatchEdgeSpec[] = []
  const duplicated: BatchEdgeSpec[] = []
  for (const spec of specs) {
    if (deciders.isDuplicate(spec)) {
      duplicated.push(spec)
      continue
    }
    if (!deciders.canConnect(spec, build)) {
      rejected.push(spec)
      continue
    }
    build.push(spec)
  }
  return { build, rejected, duplicated }
}

/**
 * 把落边计划贴回临时线：每条线带上 willConnect（会不会连上）。
 *
 * "会连上"包含两类：这一批里**要建的**（build），以及**已经存在的**（duplicate）——
 * 后者松手后那条边照样在，用户看到的语义就是"这条已经有了"，把它画成"连不上"反而误导。
 *
 * 选中节点在边上的位置取决于拖哪一侧：右侧拖出时选中节点是 source，左侧拖出时是 target。
 * 这个对号入座只在这里做一次，渲染层只管读 willConnect。
 */
export function markGuideLines(
  lines: ReadonlyArray<BatchGuideLine>,
  plan: BatchApplyPlan,
  side: BatchSide,
): BatchGuideLine[] {
  const connected = new Set<string>()
  const pick = (s: BatchEdgeSpec) => (side === 'source' ? s.source : s.target)
  for (const s of plan.build) connected.add(pick(s))
  // 已存在的边也算"会连上"（松手后它就在那儿）
  for (const s of plan.duplicated) connected.add(pick(s))
  return lines.map((l) => ({ ...l, willConnect: connected.has(l.nodeId) }))
}

/**
 * 拖动中临时线的端点侧：给渲染用。
 * 右侧拖出时临时节点在鼠标处、线从"选中集的右缘"出去；左侧反之。
 */
export function tempEdgeHandles(side: BatchSide): { sourceHandle: 'source' | 'target'; targetHandle: 'source' | 'target' } {
  return side === 'source'
    ? { sourceHandle: 'source', targetHandle: 'target' }
    : { sourceHandle: 'target', targetHandle: 'source' }
}
