/**
 * plugin-group —— 分组插件（v2 复刻老版 canvas-core/src/plugins/group）。
 *
 * 铁律对齐（masterplan §1）：
 * - 只依赖内核(canvas-base/canvas-core-v2) + 渲染层服务/事件（nodeLayout / RenderEvents），
 *   不反向依赖宿主 demo，不直碰 VueFlow 内部，不碰老版 canvas-core/src。
 * - 数据经内核 nodeStore/selection/history；坐标/尺寸经渲染层 nodeLayout（实测尺寸 + 绝对坐标）。
 * - UI 由同包 GroupContent.vue 提供（content 段，宿主 BaseNode 壳渲染），不另造节点壳。
 * - 快捷键走命令 keys（ctrl+g / ctrl+shift+g），宿主 CanvasHost 统一分发，不自绑 window。
 *
 * 与老版差异（v2 分层）：
 * - 不提供老版 BaseToolbar / 四角 resize / GroupColorButton 下拉（老版壳能力不足自造 UI；
 *   v2 BaseNode 已带标题条 + 选中环 + F2 改名，group content 只做背景 + 解组钮）。
 *   批量下载等依赖下载命令的按钮，待各节点插件提供后再补，不硬耦合。
 * - 拖动自动归组做简版：只处理顶层节点拖进某组的加入；组内拖出解组 / 组拖动边界重算
 *   依赖 VueFlow 父子拖拽语义，v2 下暂不做，在最终回复说明。
 */
import { Service, type Context, type PluginModule } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SelectionService,
  HistoryService,
} from '@mini-canvas/canvas-core-v2'
// 注意：canvas-render 只是 devDependency（类型/令牌），不能 runtime import。
// 渲染层事件名是稳定字符串常量（canvas-render RenderEvents.NodeDragEnd 同名），这里本地定义，
// 让本包纯内核即可运行（宿主 Vite 下 .vue 组件才真正消费 canvas-render）。
import type { NodeLayoutService } from '@mini-canvas/canvas-render'
import type { GroupRect, GroupBounds } from './groupEngine'
import {
  createGroupId,
  computeGroupBounds,
  toRelativePosition,
  DEFAULT_GROUP_BACKGROUND_COLOR,
} from './groupEngine'
import GroupContent from './GroupContent.vue'

/** group 节点类型名与默认声明尺寸 */
export const GROUP_NODE_TYPE = 'group'
export const GROUP_DEFAULT_SIZE = { w: 200, h: 100 }
/** 渲染层事件名（对齐 canvas-render RenderEvents.NodeDragEnd；本地复制避免 runtime 依赖渲染层） */
const NODE_DRAG_END = 'canvas:node:drag-end'

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
declare module '@mini-canvas/canvas-core-v2' {
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
  private get history(): HistoryService {
    return this.ctx.get<HistoryService>('history')
  }
  private get layout(): NodeLayoutService {
    return this.ctx.get<NodeLayoutService>('nodeLayout')
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
  private setGroupSize(groupId: string, w: number, h: number): void {
    this.nodeStore.updateNode(groupId, {
      size: { w, h },
      data: { cardWidth: w, cardHeight: h },
    })
  }

  createGroup(nodeIds: string[]): string | null {
    const nodeStore = this.nodeStore
    const byId = new Map(this.allRects().map((r) => [r.id, r]))

    // 过滤：存在、非 group、未在其它组（顶层节点）
    const eligible = nodeIds.filter((id) => {
      const node = nodeStore.getNode(id)
      if (!node) return false
      if (node.type === GROUP_NODE_TYPE) return false
      if (node.parentId) return false
      const rect = byId.get(id)
      return Boolean(rect && rect.w > 0 && rect.h > 0)
    })
    if (eligible.length < 2) return null

    const rects = eligible.map((id) => byId.get(id)!)
    const bounds = computeGroupBounds(rects)
    if (!bounds) return null

    const groupId = createGroupId()
    this.history.withRecord(() => {
      nodeStore.addNodes([
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
      nodeStore.updateNodes(
        rects.map((r) => ({
          id: r.id,
          patch: { position: toRelativePosition(r.x, r.y, bounds), parentId: groupId },
        })),
      )
      this.selection.set([groupId])
    })
    return groupId
  }

  ungroup(groupId: string): void {
    const nodeStore = this.nodeStore
    const group = nodeStore.getNode(groupId)
    if (!group || group.type !== GROUP_NODE_TYPE) return
    const childIds = nodeStore.childNodesOf(groupId).map((n) => n.id)
    this.history.withRecord(() => {
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
        nodeStore.updateNodes(patches)
      }
      nodeStore.removeNode(groupId)
      this.selection.remove(groupId)
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
    const bounds = computeGroupBounds(childRects)
    if (!bounds) return null

    this.history.withRecord(() => {
      // 组移到新左上角 + 同步声明尺寸与卡片尺寸
      nodeStore.updateNode(groupId, {
        position: { x: bounds.x, y: bounds.y },
      })
      this.setGroupSize(groupId, bounds.w, bounds.h)
      const patches = childRects.map((r) => ({
        id: r.id,
        patch: { position: toRelativePosition(r.x, r.y, bounds), parentId: groupId },
      }))
      nodeStore.updateNodes(patches)
    })
    return bounds
  }

  /** 顶层节点（无父）拖拽后落点与某 group 相交 → 移进该组（相对坐标 + 挂父） */
  reparentIfInside(nodeId: string): void {
    const nodeStore = this.nodeStore
    const node = nodeStore.getNode(nodeId)
    if (!node || node.type === GROUP_NODE_TYPE || node.parentId) return
    const rect = this.rectOf(nodeId)
    if (!rect || rect.w <= 0 || rect.h <= 0) return
    const hit = this.groupRects().find((g) => this.rectsOverlap(rect, g))
    if (!hit) return
    nodeStore.updateNode(nodeId, {
      position: toRelativePosition(rect.x, rect.y, { x: hit.x, y: hit.y, w: hit.w, h: hit.h }),
      parentId: hit.id,
    })
  }

  /** 组内子节点拖拽后绝对矩形已完全离开其父组 → 移出（还原绝对坐标 + 解父） */
  ungroupIfLeft(nodeId: string): void {
    const nodeStore = this.nodeStore
    const node = nodeStore.getNode(nodeId)
    if (!node || node.type === GROUP_NODE_TYPE || !node.parentId) return
    const parent = nodeStore.getNode(node.parentId)
    if (!parent || parent.type !== GROUP_NODE_TYPE) return
    const rect = this.rectOf(nodeId)
    const gRect = this.rectOf(parent.id)
    if (!rect || rect.w <= 0 || rect.h <= 0 || !gRect) return
    if (this.rectsOverlap(rect, gRect)) return // 仍在组内
    nodeStore.updateNode(nodeId, {
      position: { x: rect.x, y: rect.y },
      parentId: undefined,
    })
  }

  /** 全部 group 节点矩形 */
  private groupRects(): GroupRect[] {
    return this.getGroupNodeIds()
      .map((id) => this.rectOf(id))
      .filter((r): r is GroupRect => r !== null)
  }

  /** 两矩形是否相交（边缘相接不算） */
  private rectsOverlap(a: GroupRect, b: GroupRect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  }
}

export const name = 'group'
export const inject = ['nodeStore', 'selection', 'history', 'nodeLayout'] as string[]

/** 插件主体：注册 group 节点类型 + 上架 group 服务 + 命令 */
export function apply(ctx: Context) {
  const group = new GroupService(ctx)

  ctx.nodes.register({
    type: GROUP_NODE_TYPE,
    label: '分组',
    size: GROUP_DEFAULT_SIZE,
    content: GroupContent,
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
        return node && node.type !== GROUP_NODE_TYPE && !node.parentId
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
      group.ungroupIfLeft?.(payload.nodeId)
      group.reparentIfInside(payload.nodeId)
    },
  )
  ctx.effect(() => () => offDrag.dispose())
}

/** 兼容旧装配的 PluginModule 出口 */
export const groupPlugin: PluginModule = { name, inject, apply }
