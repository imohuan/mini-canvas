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
 * 写模型：所有图变更统一走 ctx.graph（GraphDocument 唯一写入口，历史 + 落盘自动）。
 * 分层：只依赖内核(canvas-base/canvas-data) + 渲染层类型/事件，不直碰 VueFlow，不碰老版 src/。
 */
import { Service, type Context, type PluginModule, type ConfigSchema, type InferConfig } from '@mini-canvas/canvas-base'
import type { NodeStoreService, SelectionService, GraphDocumentService } from '@mini-canvas/canvas-data'
// 注意：canvas-render 只是 devDependency（类型/令牌），不能 runtime import。
// 渲染层事件名是稳定字符串常量（canvas-render RenderEvents.NodeDragEnd 同名），这里本地定义，
// 让本包纯内核即可运行（宿主 Vite 下 .vue 组件才真正消费 canvas-render）。
import type { NodeLayoutService } from '@mini-canvas/canvas-render'
import type { GroupRect, GroupBounds, GroupPadding } from './groupEngine'
import {
  createGroupId,
  computeGroupBounds,
  toRelativePosition,
  toAbsolutePosition,
  resolveGroupChanges,
  DEFAULT_GROUP_BACKGROUND_COLOR,
  DEFAULT_GROUP_PADDING,
} from './groupEngine'
import GroupContent from './GroupContent.vue'

/** group 节点类型名与默认声明尺寸 */
export const GROUP_NODE_TYPE = 'group'
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

  private get nodeStore(): NodeStoreService {
    return this.ctx.get<NodeStoreService>('nodeStore')
  }
  private get selection(): SelectionService {
    return this.ctx.get<SelectionService>('selection')
  }
  private get graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
  }
  private get layout(): NodeLayoutService {
    return this.ctx.get<NodeLayoutService>('nodeLayout')
  }

  /** 组嵌套深度（不支持嵌套的画布上恒 0；B 方案允许一层 → 最大 1） */
  getGroupDepth(groupId: string): number {
    let depth = 0
    let cur = this.nodeStore.getNode(groupId)
    const seen = new Set<string>([groupId])
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) break // 环保护
      seen.add(cur.parentId)
      const parent = this.nodeStore.getNode(cur.parentId)
      if (!parent || parent.type !== GROUP_NODE_TYPE) break
      depth += 1
      cur = parent
    }
    return depth
  }

  /** 组嵌套上限（B 方案：允许一层 —— 外层组 > 内层组；内层组里不能再放组） */
  static readonly MAX_GROUP_DEPTH = 1

  /** 惰性读 settings（测试裸内核可能没注入 settings，不炸） */
  private currentPaddingOf(): GroupPadding {
    try {
      const settings = this.ctx.get<{ get(key: string): unknown }>('settings')
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
    const node = this.nodeStore.getNode(nodeId)
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
    return this.nodeStore
      .getNodes()
      .map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, w: n.size?.w ?? 0, h: n.size?.h ?? 0 }))
  }

  /** 同步 group 声明尺寸 + BaseNode 卡片尺寸（data.cardWidth/cardHeight 同值，避免视觉框不一致） */
  private groupSizePatch(w: number, h: number): { size: { w: number; h: number }; data: { cardWidth: number; cardHeight: number } } {
    return { size: { w, h }, data: { cardWidth: w, cardHeight: h } }
  }

  createGroup(nodeIds: string[]): string | null {
    const nodeStore = this.nodeStore
    const byId = new Map(this.allRects().map((r) => [r.id, r]))

    // 过滤：存在、非 group、未在其它组（顶层节点）
    const eligible = nodeIds.filter((id) => {
      const node = nodeStore.getNode(id)
      if (!node) return false
      if (node.parentId) return false
      // 组嵌套上限一层（B 方案）：已是内层组（depth>=1）的不能再被包进新组（否则深度 2 违规）
      if (node.type === GROUP_NODE_TYPE && this.getGroupDepth(id) >= GroupService.MAX_GROUP_DEPTH) return false
      const rect = byId.get(id)
      return Boolean(rect && rect.w > 0 && rect.h > 0)
    })
    if (eligible.length < 2) return null

    const rects = eligible.map((id) => byId.get(id)!)
    const bounds = computeGroupBounds(rects, { padding: this.currentPaddingOf() })
    if (!bounds) return null

    const groupId = createGroupId()
    // 统一走 graph：一次事务内建组节点 + 子节点改父/相对坐标（历史合并 + 提交落盘）
    this.graph.transaction('group-create', (tx) => {
      tx.addNodes([
        {
          id: groupId,
          type: GROUP_NODE_TYPE,
          position: { x: bounds.x, y: bounds.y },
          size: { w: bounds.w, h: bounds.h },
          data: {
            label: '',
            nodeType: GROUP_NODE_TYPE,
            backgroundColor: DEFAULT_GROUP_BACKGROUND_COLOR,
            cardWidth: bounds.w,
            cardHeight: bounds.h,
          },
        },
      ])
      tx.updateNodes(
        rects.map((r) => ({
          id: r.id,
          patch: { position: toRelativePosition(r.x, r.y, bounds), parentId: groupId },
        })),
      )
    })
    this.selection.set([groupId])
    return groupId
  }

  ungroup(groupId: string): void {
    const nodeStore = this.nodeStore
    const group = nodeStore.getNode(groupId)
    if (!group || group.type !== GROUP_NODE_TYPE) return
    const childIds = nodeStore.childNodesOf(groupId).map((n) => n.id)
    this.graph.transaction('group-ungroup', (tx) => {
      if (childIds.length > 0) {
        const patches = childIds.map((id) => {
          const node = nodeStore.getNode(id)
          if (!node) return { id, patch: {} }
          const abs = this.rectOf(id)
          if (abs) return { id, patch: { position: { x: abs.x, y: abs.y }, parentId: undefined } }
          return {
            id,
            patch: {
              position: { x: group.position.x + node.position.x, y: group.position.y + node.position.y },
              parentId: undefined,
            },
          }
        })
        tx.updateNodes(patches)
      }
      tx.removeNodes([groupId])
    })
  }

  getGroupNodeIds(): string[] {
    return this.nodeStore.getNodes().filter((n) => n.type === GROUP_NODE_TYPE).map((n) => n.id)
  }

  getGroupBounds(groupId: string): GroupBounds | null {
    const node = this.nodeStore.getNode(groupId)
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
    const nodeStore = this.nodeStore
    const group = nodeStore.getNode(groupId)
    if (!group || group.type !== GROUP_NODE_TYPE) return null
    const children = nodeStore.childNodesOf(groupId)
    if (children.length === 0) return this.getGroupBounds(groupId)

    const childRects = children
      .map((n) => this.rectOf(n.id))
      .filter((r): r is GroupRect => r !== null && r.w > 0 && r.h > 0)
    if (childRects.length === 0) return this.getGroupBounds(groupId)
    const bounds = computeGroupBounds(childRects, { padding: this.currentPaddingOf() })
    if (!bounds) return null

    // 统一走 graph：组位置/尺寸与子节点相对坐标一次事务
    this.graph.transaction('group-recalc', (tx) => {
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
    const node = this.nodeStore.getNode(nodeId)
    // 组节点参与归组（B 方案：允许嵌套一层）。组内子节点（含拖到其它组范围）正常 join/leave。
    if (!node) return
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
        this.graph.updateNode(nodeId, { position: abs, parentId: undefined })
      }
      if (change.joinGroupId) {
        const group0 = this.nodeStore.getNode(change.joinGroupId)
        if (!group0) continue
        // 防环：不能 join 自己；也不能 join 自己的后代（后代深度必然 >=1，已被上限拦，这里显式兜底）
        if (change.joinGroupId === nodeId) continue
        // 深度上限：组成员挂到目标组后深度 = 目标深度 + 1，超过上限（1）则拒绝
        if (node.type === GROUP_NODE_TYPE && this.getGroupDepth(change.joinGroupId) + 1 > GroupService.MAX_GROUP_DEPTH) {
          continue
        }
        // 目标组的 store position 在嵌套时是相对外层的 —— 相对坐标必须以"目标组真实绝对左上"为基准
        const targetAbs = this.layout.absolutePosition(change.joinGroupId)
        const rel = toRelativePosition(rect.x, rect.y, { x: targetAbs.x, y: targetAbs.y, w: group0.size?.w ?? 0, h: group0.size?.h ?? 0 })
        this.graph.updateNode(nodeId, { position: rel, parentId: group0.id })
      }
    }
  }
}

export const name = 'group'
export const inject = ['nodeStore', 'selection', 'graph', 'nodeLayout'] as string[]

/** 插件主体：注册 group 节点类型 + 上架 group 服务 + 命令。
 *  config（padding 等）不落地缓存 —— 服务每次操作惰性读 settings 单一数据源，天然实时生效。 */
export function apply(ctx: Context) {
  const group = new GroupService(ctx)

  ctx.nodes.register({
    type: GROUP_NODE_TYPE,
    label: '分组',
    size: GROUP_DEFAULT_SIZE,
    content: GroupContent,
    // 容器型节点能力：
    // - resizable：右下角拖柄改 size/cardWidth/cardHeight（一条历史，与 recalculateBounds 同字段）
    // - transparent：外壳卡片底透明（边框保留），GroupContent 铺半透明色 → 连接线透出卡片区域
    // - 空 inputs/outputs：容器不参与连线（类型级"显式声明为空 = 无端口"语义 → BaseNode 不渲染浮动端口）
    inputs: [],
    outputs: [],
    resizable: true,
    transparent: true,
  })

  ctx.commands.register({
    id: 'group:create',
    title: '创建分组',
    keys: ['ctrl+g'],
    run() {
      const nodeStore = ctx.get<NodeStoreService>('nodeStore')
      const selection = ctx.get<SelectionService>('selection')
      const ids = [...selection.ids].filter((id) => {
        const node = nodeStore.getNode(id)
        // 顶层成员（无父）参与打组；组节点允许（嵌套一层），深度超限的由 createGroup 内部过滤
        return node && !node.parentId
      })
      if (ids.length >= 2) group.createGroup(ids)
    },
  })
  ctx.commands.register({
    id: 'group:ungroup',
    title: '解散分组',
    keys: ['ctrl+shift+g'],
    run() {
      const nodeStore = ctx.get<NodeStoreService>('nodeStore')
      const selection = ctx.get<SelectionService>('selection')
      for (const id of [...selection.ids]) {
        const node = nodeStore.getNode(id)
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
}

/** 兼容旧装配的 PluginModule 出口 */
export const groupPlugin: PluginModule<GroupPluginConfig> = { name, inject, Config, apply }
