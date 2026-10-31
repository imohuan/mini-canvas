/**
 * plugin-group —— 分组插件。
 *
 * 核心模型（对齐用户拍板的分组语义）：
 * - 快捷键建组：选中 ≥2 顶层节点 Ctrl+G → 按选中节点包围盒 + 四边 padding（settings 可配）
 *   建 group 节点，子节点**绝对→相对**坐标修复后挂 parentId（组内以分组左上角为 0,0）。
 * - 拖拽归组：节点拖拽结束 → 引擎 resolveGroupChanges 决策（相交进组/离开出组），
 *   进组 = 绝对→相对 + 挂父；出组 = 相对→绝对 + 解父。坐标换算全走引擎
 *   toRelativePosition / toAbsolutePosition 一对函数（建组/解组/重算/拖拽共用）。
 * - 解组 Ctrl+Shift+G：子节点还原绝对坐标、删组节点，一条 graph 事务可撤销。
 *
 * 写模型：所有图变更统一走 ctx.get('doc')（唯一写入口，历史 + 落盘自动）。
 * 分层：只依赖内核(canvas-base/canvas-data) + 渲染层类型/事件，不直碰 VueFlow，不碰老版 src/。
 */
import { Service, type Context, type PluginModule, type ConfigSchema, type InferConfig } from '@mini-canvas/canvas-base'
import type { DocService, SelectionService } from '@mini-canvas/canvas-data'
// 注意：canvas-render 只是 devDependency（类型/令牌），不能 runtime import。
// 渲染层事件名是稳定字符串常量（canvas-render RenderEvents.NodeDragEnd 同名），这里本地定义，
// 让本包纯内核即可运行（宿主 Vite 下 .vue 组件才真正消费 canvas-render）。
import type { GroupRect, GroupBounds, GroupPadding } from './groupEngine'
import {
  computeGroupBounds,
  toRelativePosition,
  toAbsolutePosition,
  resolveGroupChanges,
  DEFAULT_GROUP_BACKGROUND_COLOR,
  DEFAULT_GROUP_PADDING,
  GROUP_NODE_TYPE,
} from './groupEngine'
import GroupContent from './GroupContent.vue'
import GroupTopToolbar from './GroupTopToolbar.vue'
import GroupTopToolbarOverlay from './GroupTopToolbarOverlay.vue'

/**
 * group 节点类型名由 groupEngine.ts 定义（单一来源），这里**转发导出**保持既有 API。
 * 为什么要转发而不是本地再定义一份：浮层组件也要用它判断"选中项是不是分组"，
 * 若让浮层从本文件 import 会成环（groupPlugin → 浮层 → groupPlugin），顶层 const 在环里可能未求值。
 */
export { GROUP_NODE_TYPE }
/** 分组节点默认声明尺寸 */
export const GROUP_DEFAULT_SIZE = { w: 200, h: 100 }
/** 渲染层事件名（对齐 canvas-render RenderEvents.NodeDragEnd；本地复制避免 runtime 依赖渲染层） */
const NODE_DRAG_END = 'canvas:node:drag-end'

// ==================== 分组 padding 配置（settings 单一数据源） ====================

/** 设置面板 key 前缀（分组留白）：同仓约定带语义前缀防撞全局命名空间 */
export const GROUP_PADDING_KEYS = {
  left: 'groupPaddingLeft',
  right: 'groupPaddingRight',
  top: 'groupPaddingTop',
  bottom: 'groupPaddingBottom',
} as const

/** Config schema（标量登记 settings 面板「布局/分组留白」；apply 收到已校验 + 补默认） */
export const Config = {
  [GROUP_PADDING_KEYS.left]: {
    type: 'number', default: DEFAULT_GROUP_PADDING.left, min: 0, max: 300, step: 5,
    label: '左边距（px）', group: '布局/分组留白',
    description: '选中节点打组（Ctrl+G）或拖节点进组时，节点内容到分组左边框的距离。',
  },
  [GROUP_PADDING_KEYS.right]: {
    type: 'number', default: DEFAULT_GROUP_PADDING.right, min: 0, max: 300, step: 5,
    label: '右边距（px）', group: '布局/分组留白',
    description: '分组边框到内容右侧的留白距离。',
  },
  [GROUP_PADDING_KEYS.top]: {
    type: 'number', default: DEFAULT_GROUP_PADDING.top, min: 0, max: 300, step: 5,
    label: '顶部边距（px）', group: '布局/分组留白',
    description: '默认比其它边大：给分组标题条留位置。',
  },
  [GROUP_PADDING_KEYS.bottom]: {
    type: 'number', default: DEFAULT_GROUP_PADDING.bottom, min: 0, max: 300, step: 5,
    label: '底部边距（px）', group: '布局/分组留白',
    description: '分组边框到内容下侧的留白距离。',
  },
} as const satisfies ConfigSchema

export type GroupPluginConfig = InferConfig<typeof Config>

/**
 * 从 settings 读当前分组 padding（逐项校验：非有限正数回落默认）。
 * settings 的值经内核 set 夹取已合法，这里兜底防御旧存档/外部写入。
 */
export function resolveGroupPadding(get: (key: string) => unknown): GroupPadding {
  const pick = (key: string, fallback: number): number => {
    const v = get(key)
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
  }
  return {
    left: pick(GROUP_PADDING_KEYS.left, DEFAULT_GROUP_PADDING.left),
    right: pick(GROUP_PADDING_KEYS.right, DEFAULT_GROUP_PADDING.right),
    top: pick(GROUP_PADDING_KEYS.top, DEFAULT_GROUP_PADDING.top),
    bottom: pick(GROUP_PADDING_KEYS.bottom, DEFAULT_GROUP_PADDING.bottom),
  }
}

/** group 服务暴露给外部插件（auto-layout / multi-select 打组调用）的 API */
export interface GroupServiceAPI {
  /** 把一组节点打成一个 group；返回 groupId，失败(成员<2 或含组/已分组)返回 null */
  createGroup(nodeIds: string[]): string | null
  /** 解散某 group：子节点恢复绝对坐标并解除父引用，删除 group 节点。包一次 history */
  ungroup(groupId: string): void
  /** 当前画布上所有 group 节点 id */
  getGroupNodeIds(): string[]
  /** 某 group 的包围盒（无该节点返回 null） */
  getGroupBounds(groupId: string): GroupBounds | null
  /**
   * 按子节点当前绝对位置重算 group bounds 并更新 group 位置/尺寸 + 子相对坐标。
   * 返回新 bounds；无该 group 返回 null。供 auto-layout 布局后调用收拢。
   */
  recalculateBounds(groupId: string): GroupBounds | null
}

/** 类型增强缝：宿主/插件可 ctx.group 直访 */
declare module '@mini-canvas/canvas-data' {
  interface Context {
    group: GroupServiceAPI
  }
}

/**
 * 分组服务。方法内惰性取现时服务，不缓存（cordis 规范）。
 * 布局/尺寸经 ctx.get('nodeLayout')：渲染层注入（读 nodeStore + ResizeObserver 实测），
 * node 测试环境由测试注入等价 stub（提供 getAllRects/nodeSize/absolutePosition）。
 */
export class GroupService extends Service implements GroupServiceAPI {
  constructor(ctx: Context) {
    super(ctx, 'group')
  }

  private get selection(): SelectionService {
    return this.ctx.get('selection')
  }
  private get doc(): DocService {
    return this.ctx.get('doc')
  }
  private get layout() {
    return this.ctx.get('nodeLayout')
  }

  /** 组嵌套深度（不支持嵌套的画布上恒 0；B 方案允许一层 → 最大 1） */
  getGroupDepth(groupId: string): number {
    let depth = 0
    let cur = this.doc.getNode(groupId)
    const seen = new Set<string>([groupId])
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) break // 环保护
      seen.add(cur.parentId)
      const parent = this.doc.getNode(cur.parentId)
      if (!parent || parent.type !== GROUP_NODE_TYPE) break
      depth += 1
      cur = parent
    }
    return depth
  }

  /**
   * 组嵌套上限（按**组节点自己的深度**算：0 = 顶层组）。
   *
   * 为什么恰好是 1（而不是拍脑袋）：这条上限的两个端点都已经有硬约束 ——
   * - **下界**（为什么不是 0）：用户 2026-10-08 报「我这边已经在一个分组内，选中两个节点
   *   按 Ctrl+G 没有分组」。组内打出来的新组就是深度 1，所以 0 不够用；
   * - **上界**（为什么不是 2+）：渲染层给容器型节点的垫底档只有两档
   *   （`canvasHostCore.nodesFromStore`：顶层组 -3、其余 -2），而 VueFlow 每挂一层父就
   *   把 computed z 抬 1。实测：深度 0 → -3，深度 1 → -1（都在连线 0 之下 ✓），
   *   深度 2 → 0（**与连线同层**，组会盖住/被盖住，视觉分层失效）。
   * 想再深必须先改渲染层的垫底档位，不能只在这里放行 —— 那会造出渲染分不清层级的组。
   */
  static readonly MAX_GROUP_DEPTH = 1

  /**
   * 某节点子树内最深的分组**相对层数**（自己算 0）。
   *
   * 用途：把「带着孙组的组」塞进别处时，要保证**整棵子树**都不超深 —— 只看自己那一层
   * 会让孙组悄悄越界（嵌套上限就成了摆设）。
   */
  private groupSubtreeDepth(nodeId: string): number {
    let max = 0
    const seen = new Set<string>([nodeId])
    const walk = (id: string, rel: number): void => {
      for (const child of this.doc.childNodesOf(id)) {
        if (child.type !== GROUP_NODE_TYPE) continue
        if (seen.has(child.id)) continue // 环保护
        seen.add(child.id)
        if (rel + 1 > max) max = rel + 1
        walk(child.id, rel + 1)
      }
    }
    walk(nodeId, 0)
    return max
  }

  /** 惰性读 settings（测试裸内核可能没注入 settings，不炸） */
  private currentPaddingOf(): GroupPadding {
    try {
      const settings = this.ctx.tryGet('settings')
      if (settings && typeof settings.get === 'function') {
        return resolveGroupPadding((key) => settings.get(key))
      }
    } catch {
      /* 无 settings 服务 → 回落默认 */
    }
    return { ...DEFAULT_GROUP_PADDING }
  }

  /** 某节点绝对矩形（优先 nodeLayout 实测/绝对；缺服务退化为声明数据兜底） */
  private rectOf(nodeId: string): GroupRect | null {
    const layout = this.layout
    if (layout && typeof layout.getNodeRect === 'function') {
      const rect = layout.getNodeRect(nodeId)
      if (rect) return rect as GroupRect
    }
    const node = this.doc.getNode(nodeId)
    if (!node) return null
    return { id: nodeId, x: node.position.x, y: node.position.y, w: node.size?.w ?? 0, h: node.size?.h ?? 0 }
  }

  /** 全部存活节点绝对矩形 */
  private allRects(): GroupRect[] {
    const layout = this.layout
    if (layout && typeof layout.getAllRects === 'function') {
      const rects = layout.getAllRects()
      if (rects && rects.length > 0) return rects as GroupRect[]
    }
    return this.doc
      .getNodes()
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.size?.w ?? 0, h: n.size?.h ?? 0 }))
  }

  /**
   * 组尺寸写回补丁：只给正式字段 size（唯一正身）。
   * 卡片镜像 data.cardWidth/cardHeight 由 nodeStore 从 size 自动生成，不再手写一份。
   */
  private groupSizePatch(w: number, h: number): { size: { w: number; h: number } } {
    return { size: { w, h } }
  }

  createGroup(nodeIds: string[]): string | null {
    const byId = new Map(this.allRects().map((r) => [r.id, r]))

    /**
     * 过滤：存在、有实测矩形、能**一起**装进新组且不越嵌套上限。
     *
     * 与老实现的两处关键差别（用户报的「在分组内选中两个节点按 Ctrl+G 没反应」）：
     * ① **组内节点也允许打组** —— 老实现一刀切 `if (node.parentId) return false`，
     *    只要节点已经在某个组里，Ctrl+G 就永远选不出 2 个，命令静默失败。
     * 用户要的语义：在新组里把「这两个节点」从原组**搬进**新组（新组落在同一个父组内，
     *    于是还是同一层里的容器，视觉上就是原组里套一个小分组）；
     * ② **共同父必须一致**：跨组的两个节点不能凭空建组 —— 那要么把节点从原组里偷走、
     *    要么产生跨层父子，两种都不是用户要的。跨组时给 null，由命令层提示原因。
     */
    const pickParent = (): string | undefined | false => {
      const first = this.doc.getNode(nodeIds[0]!)
      const pid = first?.parentId
      for (const id of nodeIds) {
        if (this.doc.getNode(id)?.parentId !== pid) return false
      }
      return pid
    }
    const sharedParent = pickParent()
    if (sharedParent === false) return null
    // 共同父本身也在选中集里 = 组自己带着子节点打组（老实现靠「组节点已分组会被过滤」绕过）；
    // 这里显式拒：否则新组会一边要包住父、一边要搬走父的孩子，语义自相矛盾。
    if (sharedParent !== undefined && nodeIds.includes(sharedParent)) return null

    // 父链深度（本组将落在这个深度上）；越限直接拒，别建出渲染层分不清层级的组
    const parentDepth = sharedParent === undefined ? 0 : this.getGroupDepth(sharedParent) + 1
    if (parentDepth > GroupService.MAX_GROUP_DEPTH) return null

    const eligible = nodeIds.filter((id) => {
      const node = this.doc.getNode(id)
      if (!node) return false
      // 组节点：自己 + 自己的子树都不能越限（子树里可能还挂着别的组）
      if (node.type === GROUP_NODE_TYPE) {
        if (parentDepth + 1 + this.groupSubtreeDepth(id) > GroupService.MAX_GROUP_DEPTH) return false
      }
      const rect = byId.get(id)
      return Boolean(rect && rect.w > 0 && rect.h > 0)
    })
    if (eligible.length < 2) return null

    const rects = eligible.map((id) => byId.get(id)!)
    const bounds = computeGroupBounds(rects, { padding: this.currentPaddingOf() })
    if (!bounds) return null

    // 组节点的 id 也统一向内核要（自增数字）：插件不自造 `group-时间戳-序号` 那种形态。
    const groupId = this.doc.nextNodeId()
    /**
     * 新组自己写进 store 的坐标：相对**共同父**的局部值（顶层组就是绝对坐标）。
     *
     * 必须先把共同父的绝对位置取出来：组内节点的 position 是相对原父组的，而包围盒 bounds
     * 是绝对坐标 —— 两套坐标系不换算直接混用会整体偏移一个父组的位置（嵌套后必现）。
     */
    const parentAbs = sharedParent === undefined ? null : this.layout.absolutePosition(sharedParent)
    const groupPos = parentAbs ? toRelativePosition(bounds.x, bounds.y, parentAbs) : { x: bounds.x, y: bounds.y }
    // 统一走 graph：一次事务内建组节点 + 子节点改父/相对坐标（历史合并 + 提交落盘）
    this.doc.transaction('group-create', (tx) => {
      tx.addNodes([
        {
          id: groupId,
          type: GROUP_NODE_TYPE,
          position: groupPos,
          size: { w: bounds.w, h: bounds.h },
          // 组内打组：新组直接挂进共同父（与子节点同一次事务，位置一次写对，不留中间态）
          ...(sharedParent !== undefined ? { parentId: sharedParent } : {}),
          data: {
            // 不显式给 label：交给数据层按类型模板生成默认名（分组 1、分组 2…）。
            // 以前给空串会把默认名顶掉，标题条就只剩类型名。
            nodeType: GROUP_NODE_TYPE,
            backgroundColor: DEFAULT_GROUP_BACKGROUND_COLOR,
          },
        },
      ])
      tx.updateNodes(
        rects.map((r) => ({
          id: r.id,
          patch: {
            // 子节点的相对坐标一律相对新组的**绝对**左上角（bounds 就是绝对坐标）。
            position: toRelativePosition(r.x, r.y, bounds),
            parentId: groupId,
          },
        })),
      )
    })
    this.selection.set([groupId])
    return groupId
  }

  ungroup(groupId: string): void {
    const group = this.doc.getNode(groupId)
    if (!group || group.type !== GROUP_NODE_TYPE) return
    const childIds = this.doc.childNodesOf(groupId).map((n) => n.id)
    /**
     * 孩子们解组后归谁：**组自己的父**（顶层组就是 undefined = 回顶层）。
     *
     * 为什么要看组自己的父（2026-10-08 与「组内打组」配套修）：解掉一个**嵌套的内层组**时，
     * 它的内容应该留在外层组里（升为外层组的直接成员）—— 老实现一律 `parentId: undefined`，
     * 等于顺手把内容扔出了外层组，用户看到的是「我只解散了里面小分组，外面的东西全飞了」。
     */
    const nextParent = group.parentId
    const nextParentAbs = nextParent === undefined ? null : this.layout.absolutePosition(nextParent)
    this.doc.transaction('group-ungroup', (tx) => {
      if (childIds.length > 0) {
        const patches = childIds.map((id) => {
          const node = this.doc.getNode(id)
          if (!node) return { id, patch: {} }
          const abs = this.rectOf(id)
          if (abs) {
            // 绝对坐标 → 相对**新父**的局部坐标（新父是顶层时就是绝对坐标本身）
            const pos = nextParentAbs ? toRelativePosition(abs.x, abs.y, nextParentAbs) : { x: abs.x, y: abs.y }
            return { id, patch: { position: pos, parentId: nextParent } }
          }
          // 退路（没有布局服务）：group.position 本身就是相对新父（顶层时是绝对）的，
          // 再加子节点相对 group 的偏移即可 —— 两条分支同一条公式，嵌套与否都成立。
          return {
            id,
            patch: {
              position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y },
              parentId: nextParent,
            },
          }
        })
        tx.updateNodes(patches)
      }
      tx.removeNodes([groupId])
    })
  }

  getGroupNodeIds(): string[] {
    return this.doc.getNodes().filter((n) => n.type === GROUP_NODE_TYPE).map((n) => n.id)
  }

  getGroupBounds(groupId: string): GroupBounds | null {
    const node = this.doc.getNode(groupId)
    if (!node || node.type !== GROUP_NODE_TYPE) return null
    const abs = this.rectOf(groupId)
    return {
      x: abs?.x ?? node.position.x,
      y: abs?.y ?? node.position.y,
      w: abs?.w ?? node.size?.w ?? 0,
      h: abs?.h ?? node.size?.h ?? 0,
    }
  }

  recalculateBounds(groupId: string): GroupBounds | null {
    const group = this.doc.getNode(groupId)
    if (!group || group.type !== GROUP_NODE_TYPE) return null
    const children = this.doc.childNodesOf(groupId)
    if (children.length === 0) return this.getGroupBounds(groupId)

    const childRects = children
      .map((n) => this.rectOf(n.id))
      .filter((r): r is GroupRect => r !== null && r.w > 0 && r.h > 0)
    if (childRects.length === 0) return this.getGroupBounds(groupId)
    const bounds = computeGroupBounds(childRects, { padding: this.currentPaddingOf() })
    if (!bounds) return null

    // 统一走 graph：组位置/尺寸与子节点相对坐标一次事务
    this.doc.transaction('group-recalc', (tx) => {
      tx.updateNode(groupId, {
        position: { x: bounds.x, y: bounds.y },
        ...this.groupSizePatch(bounds.w, bounds.h),
      })
      const patches = childRects.map((r) => ({
        id: r.id,
        patch: { position: toRelativePosition(r.x, r.y, bounds), parentId: groupId },
      }))
      tx.updateNodes(patches)
    })
    return bounds
  }

  /** 全部 group 节点矩形 */
  private groupRects(): GroupRect[] {
    return this.getGroupNodeIds()
      .map((id) => {
        const rect = this.rectOf(id)
        // 嵌套深度参与命中决策：深度深 = 渲染 z 高 = 视觉在上层 → 优先命中（用户实测：内层组被外层拦截的 bug）
        return rect ? { ...rect, depth: this.getGroupDepth(id) } : null
      })
      .filter((r): r is GroupRect & { depth: number } => r !== null)
  }

  /**
   * 拖拽结束后的归组归属判定（唯一入口）：走引擎 resolveGroupChanges 纯函数决策，
   * join → 挂父 + 绝对转相对；leave → 解父 + 相对还原绝对。每次只处理一个节点
   * （宿主按 drag-end 逐节点调用）。
   */
  applyDragMembership(nodeId: string): void {
    const node = this.doc.getNode(nodeId)
    // 组节点参与归组（B 方案：允许嵌套一层）。组内子节点（含拖到其它组范围）正常 join/leave。
    if (!node) return
    /**
     * 分镜组的槽位成员不参与分组归组（用户实测 2026-10-31：一槽两图）。
     *
     * 分镜组是**另一种容器**：它的子节点由 slots 锁定在槽位上，位置是相对分镜组的。
     * 而分镜组卡片本身可能正落在一个普通分组里（或压在分组范围内），于是同一个拖拽结束
     * 事件会先被分镜组吸附、再被本服务判成"落进了分组"→ 给节点改 parentId 到分组，
     * 两套容器各认一半：slots 还写着它、parentId 却指向分组，视觉上就是两张图叠一格。
     * 归属只认一个：已经在分镜组里的，分组这边一律不碰。
     *
     * 判据直接读 parentId 指向的节点类型，不 import 分镜组插件（两个插件互不依赖）。
     */
    const parentType = node.parentId ? this.doc.getNode(node.parentId)?.type : undefined
    if (parentType === 'storyboard') return
    const rect = this.rectOf(nodeId)
    if (!rect || rect.w <= 0 || rect.h <= 0) return
    const changes = resolveGroupChanges(
      [{ id: nodeId, rect, currentParentId: node.parentId }],
      this.groupRects(),
    )
    for (const change of changes) {
      if (change.leaveGroupId) {
        // leave 的绝对坐标 = 节点当前真实绝对位置（父链完整累加 —— 嵌套时直接父的 store pos 是相对外层的，
        // 只加一层会少加，用户实测"第二层出来位置错"就是这个）。node 此刻仍挂着父链，absolutePosition 正确。
        const abs = this.layout.absolutePosition(nodeId)
        this.doc.updateNode(nodeId, { position: abs, parentId: undefined })
      }
      if (change.joinGroupId) {
        const group0 = this.doc.getNode(change.joinGroupId)
        if (!group0) continue
        // 防环：不能 join 自己；也不能 join 自己的后代（后代深度必然 >=1，已被上限拦，这里显式兜底）
        if (change.joinGroupId === nodeId) continue
        // 深度上限：组成员挂到目标组后深度 = 目标深度 + 1，超过上限（1）则拒绝
        // 组节点还要带上自己的**整棵子树**：它下面若还挂着组，只算自己那一层会让孙组悄悄越界
        // （与 createGroup 同一条判据，两条路径不能各判各的）。
        if (
          node.type === GROUP_NODE_TYPE &&
          this.getGroupDepth(change.joinGroupId) + 1 + this.groupSubtreeDepth(nodeId) > GroupService.MAX_GROUP_DEPTH
        ) {
          continue
        }
        // 目标组的 store position 在嵌套时是相对外层的 —— 相对坐标必须以"目标组真实绝对左上"为基准
        const targetAbs = this.layout.absolutePosition(change.joinGroupId)
        const rel = toRelativePosition(rect.x, rect.y, { x: targetAbs.x, y: targetAbs.y })
        this.doc.updateNode(nodeId, { position: rel, parentId: group0.id })
      }
    }
  }
}

export const name = 'group'
export const inject = ['doc', 'selection', 'nodeLayout'] as string[]

/** 插件主体：注册 group 节点类型 + 上架 group 服务 + 命令。
 *  config（padding 等）不落地缓存 —— 服务每次操作惰性读 settings 单一数据源，天然实时生效。 */
export function apply(ctx: Context) {
  const group = new GroupService(ctx)

  ctx.nodes.register({
    type: GROUP_NODE_TYPE,
    label: '分组',
    size: GROUP_DEFAULT_SIZE,
    in: GroupContent,
    // ⚠️ 这里**故意不注册** out:top 段。分组的控制栏有个绕不开的层级问题：
    // 分组卡片的"垫底"靠给分组节点写 z-index:-3（canvasHostCore），而 z-index 非 auto 就在
    // 该节点上创建层叠上下文 —— 写在节点内部的段（原本 z-index:30）会被整个关进 -3 里，
    // 数字再大也越不过兄弟节点，任何普通节点都能盖住它（用户报的"被节点遮挡"）。
    // 所以分组的控制栏改挂**画布 overlay 槽**（压在整个 VueFlow 之上），见下方 slots.register。
    // 按钮内容仍是同一份 GroupTopToolbar，只是宿主换了层。
    // 容器型节点能力：
    // - resizable：右下角拖柄改 size/cardWidth/cardHeight（一条历史，与 recalculateBounds 同字段）
    // - transparent：外壳卡片底透明（边框保留），GroupContent 铺半透明色 → 连接线透出卡片区域
    // - 空 inputs/outputs：容器不参与连线（类型级"显式声明为空 = 无端口"语义 → BaseNode 不渲染浮动端口）
    inputs: [],
    outputs: [],
    resizable: true,
    transparent: true,
  })

  // 分组控制栏挂画布 overlay 槽（压在整个 VueFlow 之上，见上方注释里那段层叠上下文说明）。
  // 浮层宿主自己判"恰好单选了一个分组节点"，并把 GroupTopToolbar 摆到卡片正上方。
  ctx.slots.register('overlay', {
    id: 'group/top-toolbar',
    order: 35,
    component: GroupTopToolbarOverlay,
    meta: { title: '分组上控制栏' },
  })

  ctx.commands.register({
    id: 'group:create',
    title: '创建分组',
    keys: ['ctrl+g'],
    run() {
      const selection = ctx.get('selection')
      const doc = ctx.get('doc')
      /**
       * 候选 = 选中的**存活节点**（不再一刀切滤掉「已在组内」的）。
       *
       * 用户报的 bug（2026-10-08）：「我这边已经在一个分组内，选中两个节点，按 Ctrl+G 它没有分组。
       * 只有我把这两个节点拖拽到这个分组外的时候，分组的快捷键才生效」。根因就是这里
       * `!node.parentId` 把组内节点全滤掉了，剩下 0~1 个 → 命令静默什么都不做。
       * 「能不能一起装进新组」这件事由 createGroup 自己判（共同父 / 嵌套上限），命令层不再预判。
       */
      const ids = [...selection.ids].filter((id) => Boolean(doc.getNode(id)))
      if (ids.length >= 2) group.createGroup(ids)
    },
  })
  ctx.commands.register({
    id: 'group:ungroup',
    title: '解散分组',
    keys: ['ctrl+shift+g'],
    run() {
      const selection = ctx.get('selection')
      const doc = ctx.get('doc')
      for (const id of [...selection.ids]) {
        const node = doc.getNode(id)
        if (node && node.type === GROUP_NODE_TYPE) group.ungroup(id)
      }
    },
  })

  const offDrag = ctx.on(
    NODE_DRAG_END,
    (payload: { nodeId: string; position: { x: number; y: number } }) => {
      group.applyDragMembership(payload.nodeId)
    },
  )
  ctx.effect(() => () => offDrag.dispose())

  /**
   * 存量迁移：给「标题是空串」的老分组补编号默认名。
   *
   * 为什么需要（用户报的「分组标题重复」的另一半）：老版本的 createGroup 在 data 里写了
   * `label: ''`，把数据层的默认名（"分组 1"）顶掉了 —— 于是已有画布上的每个分组标题都空着，
   * 标题条 / 左侧树回落到类型名，看起来全叫「分组」。新版本不再写空串（新分组直接拿到编号名），
   * 但**已经存下来的**那批组得补一次，否则用户打开旧画布还是看到一排「分组」。
   *
   * 只认 `label === ''`（老版本留下的空串）：`label === undefined`（键都不在）表示用户
   * 主动清空过标题 —— 那是他的选择，不该被悄悄改名。命名走 doc.nextTypeName（与新建同一条
   * 计数），所以补出来的号不会和之后新建的组撞。
   */
  const backfillLegacyGroupNames = (): void => {
    const doc = ctx.get('doc')
    const stale = doc.getNodes().filter((n) => n.type === GROUP_NODE_TYPE && n.data?.label === '')
    if (stale.length === 0) return
    doc.updateNodes(
      stale.map((n) => ({ id: n.id, patch: { data: { label: doc.nextTypeName(GROUP_NODE_TYPE) } } })),
    )
  }
  // ① 立即跑一次：插件是**热装**的（插件管理装进来时画布早已 restore 完毕），apply 时点就在场
  backfillLegacyGroupNames()
  // ② 订阅 replace：冷启动装配时 restore 发生在插件 apply **之后**（见 createMiniCanvasHost），
  //    以及切画布/云端整体覆盖也走 replace —— 这两条路都要补。
  const offBackfill = ctx.get('doc').subscribe((change) => {
    if (change.kind === 'node' && change.reason === 'replace') backfillLegacyGroupNames()
  })
  ctx.effect(() => () => offBackfill())
}

/** 兼容旧装配的 PluginModule 出口 */
export const groupPlugin: PluginModule<GroupPluginConfig> = { name, inject, Config, apply }
