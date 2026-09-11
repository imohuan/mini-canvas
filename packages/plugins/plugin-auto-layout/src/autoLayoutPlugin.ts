/**
 * plugin-auto-layout —— 自动布局插件（v2 复刻老版 canvas-core/src/plugins/auto-layout）。
 *
 * 功能：
 *   - 嵌套分簇布局（组内节点 / 连通分量 / 孤立节点 / 跨簇 Super-Cluster），dagre 排布；
 *   - 布局后自动收拢每个分组（重算 group 位置/尺寸 + 子节点转相对坐标重新挂回 parentId）；
 *   - F 键聚焦选中、Ctrl/Cmd+L 自动布局、R 适应视图。
 *
 * v2 分层（masterplan §1）：
 *   - 数据：nodeStore/edgeStore（宿主恒在）；几何：nodeLayout（实测尺寸 + 绝对坐标）。
 *   - 写回：history.withRecord 一次原子 + nodeStore.updateNodes 批量。
 *   - 快捷键：命令 keys（mod+l / f / r），渲染层 CanvasHost 统一分发；不自绑 window。
 *   - 组收拢用本包纯函数（groupBounds.ts），不硬依赖 group 插件 —— 无 group 服务也能独立工作；
 *     仅"框尺寸样式同步"是通用声明（size + data.cardWidth/cardHeight），与 plugin-group 写同一套字段。
 *   - Config schema：模块级 Config，内核装配时校验 + 补默认 + 登记 settings 面板。
 *
 * 与老版差异（v2 语义）：
 *   - 老版布局后"清 parentNode 脱离组，再 rAF 重挂"；v2 是数据层，一次 withRecord 内：
 *     引擎输出绝对坐标 → 组 frame = 子节点绝对包围盒+padding → 更新组节点 + 子节点相对坐标(挂回 parentId)。
 *   - 老版布局后移动视口到结果中心（keepZoom）；v2 布局命令只改数据 + 居中视口（viewport.setCenter 保留 zoom）。
 */

import type { Context, PluginModule, ConfigSchema, InferConfig } from '@mini-canvas/canvas-base'
import { resolveConfig } from '@mini-canvas/canvas-base'
import type {
 NodeStoreService,
 EdgeStoreService,
 SelectionService,
  GraphDocumentService,
 CanvasNode,
} from '@mini-canvas/canvas-core-v2'
import type { NodeLayoutService, ViewportService } from '@mini-canvas/canvas-render'
import { runAutoLayout } from './layoutEngine'
import type { LayoutNode, LayoutEdge, LayoutDirection, AutoLayoutConfig } from './types'
import { calculateGroupFrameFromAbsoluteChildren } from './groupBounds'
import { calculateFocusZoom, centerViewportOnBounds, type Bounds } from './focusViewport'

/** 组节点类型名（与 plugin-group 约定一致） */
export const GROUP_NODE_TYPE = 'group'

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeStore: NodeStoreService
    edgeStore: EdgeStoreService
    selection: SelectionService
    graph: GraphDocumentService
    nodeLayout: NodeLayoutService
    viewport: ViewportService
  }
}

export const name = 'auto-layout'
export const inject = ['nodeStore', 'edgeStore', 'selection', 'graph', 'nodeLayout', 'viewport'] as string[]

/**
 * Config schema（标量字段登记 settings 面板；apply 收到的 config 已校验 + 补默认）。
 *
 * 分组命名：`一级/二级`（设置面板左侧一级导航、右侧二级页签条）。
 * 一级统一「布局」；二级带功能名前缀。plugin-align-arrange（Ctrl+方向键）的间距项也登记在
 * 「布局/自动布局方向」同一格里（用户指定），故字段 label/description 必须写明各自归属，
 * 否则用户分不清哪个是 Ctrl/Cmd+L、哪个是 Ctrl+方向键。
 */
export const Config = {
  // —— 布局 / 自动布局方向 ——
  direction: {
    type: 'select',
    default: 'LR',
    label: '布局方向',
    description:
      '【Ctrl/Cmd+L 自动布局】节点自动布局的走向：左→右 / 上→下 / 右→左 / 下→上。决定连线整体朝哪个方向铺开。',
    group: '布局/自动布局方向',
    options: [
      { value: 'LR', label: '左→右 (LR)' },
      { value: 'TB', label: '上→下 (TB)' },
      { value: 'RL', label: '右→左 (RL)' },
      { value: 'BT', label: '下→上 (BT)' },
    ],
  },
  // —— 布局 / 自动布局间距 ——
  intraSpacingX: {
    type: 'number', default: 60, min: 20, max: 300, step: 10, label: '组内水平间距（左右）', group: '布局/自动布局间距',
    description:
      '【Ctrl/Cmd+L 自动布局】同一层级/分组内部，节点之间的左右间隙（px）。对应画布 X 轴方向。调大让组内节点彼此更疏。',
  },
  intraSpacingY: {
    type: 'number', default: 80, min: 20, max: 300, step: 10, label: '组内垂直间距（上下）', group: '布局/自动布局间距',
    description: '【Ctrl/Cmd+L 自动布局】同一层级/分组内部，节点之间的上下间隙（px）。对应画布 Y 轴方向。',
  },
  interSpacingX: {
    type: 'number', default: 120, min: 40, max: 500, step: 10, label: '组间水平间距（左右）', group: '布局/自动布局间距',
    description:
      '【Ctrl/Cmd+L 自动布局】不同分组（/集群）之间的左右间隙（px）。对应画布 X 轴方向。调大让各组左右分得更开。',
  },
  interSpacingY: {
    type: 'number', default: 120, min: 40, max: 500, step: 10, label: '组间垂直间距（上下）', group: '布局/自动布局间距',
    description: '【Ctrl/Cmd+L 自动布局】不同分组（/集群）之间的上下间隙（px）。对应画布 Y 轴方向。',
  },
  // —— 布局 / 自动布局聚焦（F 键聚焦选中节点时的取景）——
  focusHeightRatio: {
    type: 'number', default: 0.5, min: 0.1, max: 0.9, step: 0.05, label: '聚焦高度占比', group: '布局/自动布局聚焦',
    description:
      '【F 聚焦选中节点】想让所选内容占画布可视高度的比例（0.5 = 占一半），保证周围留出上下文。',
  },
  minZoom: {
    type: 'number', default: 0.1, min: 0.05, max: 1, step: 0.05, label: '聚焦最小缩放', group: '布局/自动布局聚焦',
    description: '【F 聚焦选中节点】聚焦时允许缩到的最小倍率。内容特别多时也不会缩得比它更小。',
  },
  maxZoom: {
    type: 'number', default: 4, min: 1, max: 8, step: 0.5, label: '聚焦最大缩放', group: '布局/自动布局聚焦',
    description: '【F 聚焦选中节点】聚焦时允许放大的最大倍率，避免选中单个小节点时画面放大过头。',
  },
  // —— 布局 / 诊断（两个布局插件的诊断开关同住一格，字段名各自写明归属）——
  debug: {
    type: 'boolean', default: false, label: '自动布局诊断日志', group: '布局/诊断',
    description: '打开后，每次自动布局会在控制台打印分组/布局决策日志，便于排查布局结果是否符合预期。',
  },
} satisfies ConfigSchema

export type AutoLayoutConfigFromSchema = InferConfig<typeof Config>

/** 组装引擎配置（config 标量 → 引擎 { direction, intraSpacing, interSpacing, … }） */
function toEngineConfig(c: AutoLayoutConfigFromSchema): AutoLayoutConfig {
  return {
    direction: c.direction as LayoutDirection,
    intraSpacing: { x: c.intraSpacingX, y: c.intraSpacingY },
    interSpacing: { x: c.interSpacingX, y: c.interSpacingY },
    focusHeightRatio: c.focusHeightRatio,
    minZoom: c.minZoom,
    maxZoom: c.maxZoom,
    debug: c.debug,
  }
}

export function apply(ctx: Context, rawConfig?: AutoLayoutConfigFromSchema) {
  const { nodeStore, edgeStore, selection, graph, nodeLayout, viewport } = ctx
  // 装配 config 缺省（冷启动没给配置）时用 schema 默认补齐——与内核 resolveConfig 行为一致
  const effectiveConfig = (rawConfig ?? resolveConfig(Config)) as AutoLayoutConfigFromSchema

  // 设置面板单一数据源（内置恒在）。每次执行命令时**实时**读它 —— 面板改过立刻生效。
  const settings = ctx.get<{ get(key: string): string | number | boolean | undefined } | undefined>('settings')

  /**
   * 取当前生效配置：settings 现值优先，未声明/服务缺失回落 schema 默认。
   *
   * 关键：不能把 apply 时的 config 冻结成闭包常量——那样设置面板改了值，命令仍用旧值，
   * 表现为"改了配置不生效"。故布局/聚焦每次执行都经本函数现读一次。
   */
  function currentConfig(): AutoLayoutConfig {
    const read = <T extends string | number | boolean>(key: string, fallback: T): T => {
      const v = settings?.get(key)
      return (v === undefined || v === null ? fallback : v) as T
    }
    return toEngineConfig({
      direction: read('direction', effectiveConfig.direction),
      intraSpacingX: read('intraSpacingX', effectiveConfig.intraSpacingX),
      intraSpacingY: read('intraSpacingY', effectiveConfig.intraSpacingY),
      interSpacingX: read('interSpacingX', effectiveConfig.interSpacingX),
      interSpacingY: read('interSpacingY', effectiveConfig.interSpacingY),
      focusHeightRatio: read('focusHeightRatio', effectiveConfig.focusHeightRatio),
      minZoom: read('minZoom', effectiveConfig.minZoom),
      maxZoom: read('maxZoom', effectiveConfig.maxZoom),
      debug: read('debug', effectiveConfig.debug),
    })
  }

  /** 节点绝对矩形快照（nodeLayout 实测/绝对；无服务退化为声明数据兜底） */
  function absoluteRectOf(n: CanvasNode): { x: number; y: number; w: number; h: number } {
    const rect = nodeLayout?.getNodeRect?.(n.id)
    if (rect && rect.w > 0 && rect.h > 0) return rect
    return {
      x: n.position.x,
      y: n.position.y,
      w: n.size?.w ?? 200,
      h: n.size?.h ?? 100,
    }
  }

  /** 组：{ groupNode, 直接子节点(仅第一层、非 group) } */
  function collectGroups() {
    const nodes = nodeStore.getNodes()
    const groupNodes = nodes.filter((n) => n.type === GROUP_NODE_TYPE)
    const groups: Array<{ groupNode: CanvasNode; children: CanvasNode[] }> = []
    for (const g of groupNodes) {
      const children = nodeStore.childNodesOf(g.id).filter((c) => c.type !== GROUP_NODE_TYPE)
      groups.push({ groupNode: g, children })
    }
    return { nodes, groups }
  }

  /** 引擎输入：全部"参与布局"节点（组节点本身不参与；子节点转绝对坐标快照）。 */
  function buildLayoutInput() {
    const { nodes, groups } = collectGroups()
    const groupNodeIds = new Set(nodes.filter((n) => n.type === GROUP_NODE_TYPE).map((n) => n.id))
    const layoutNodes: LayoutNode[] = []
    for (const n of nodes) {
      if (groupNodeIds.has(n.id)) continue
      const abs = absoluteRectOf(n)
      // 注意：喂给引擎的 position 是绝对坐标（布局期间平铺所有子节点）
      layoutNodes.push({
        id: n.id,
        type: n.type,
        position: { x: abs.x, y: abs.y },
        data: n.data,
        size: { w: abs.w, h: abs.h },
      })
    }
    const edges: LayoutEdge[] = edgeStore
      .getEdges()
      .map((e) => ({ id: e.id, source: e.source, target: e.target }))
    return {
      layoutNodes,
      edges,
      groups: groups
        .filter((g) => g.children.length > 0)
        .map((g) => ({ id: g.groupNode.id, nodeIds: new Set(g.children.map((c) => c.id)) })),
    }
  }

  function focusBounds(nodes: CanvasNode[], opts: { keepZoom: boolean }): void {
    if (nodes.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const n of nodes) {
      const abs = absoluteRectOf(n)
      minX = Math.min(minX, abs.x)
      minY = Math.min(minY, abs.y)
      maxX = Math.max(maxX, abs.x + abs.w)
      maxY = Math.max(maxY, abs.y + abs.h)
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return
    const cfg = currentConfig()
    const bounds: Bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    const cur = viewport.getViewport()
    // 视口尺寸：优先取本画布实例根（viewport.getRootEl，多宿主不串线）；无 DOM 环境(node 测试)退化为 1:1
    const scopeRoot = viewport.getRootEl?.() ?? (typeof document !== 'undefined' ? document.querySelector('.vue-flow') : null)
    const vw = scopeRoot?.clientWidth || 1
    const vh = scopeRoot?.clientHeight || 1
    const zoom = opts.keepZoom
      ? cur.zoom
      : calculateFocusZoom({
          boundsHeight: bounds.height,
          viewportHeight: vh,
          heightRatio: cfg.focusHeightRatio,
          minZoom: cfg.minZoom,
          maxZoom: cfg.maxZoom,
        })
    viewport.setViewport(
      centerViewportOnBounds({ bounds, viewportWidth: vw, viewportHeight: vh, zoom }),
    )
  }

  function focusSelected(): boolean {
    const selected = [...selection.ids]
      .map((id) => nodeStore.getNode(id))
      .filter((n): n is CanvasNode => Boolean(n))
    if (selected.length === 0) return false
    focusBounds(selected, { keepZoom: false })
    return true
  }

  function focusNode(nodeId: string): boolean {
    const n = nodeStore.getNode(nodeId)
    if (!n) return false
    focusBounds([n], { keepZoom: false })
    return true
  }

  /** 布局后收拢一个组：子节点绝对坐标 → 组 frame → 更新组 + 子相对坐标(挂回) */
  function updateGroupAfterLayout(
    groupNode: CanvasNode,
    childNodes: CanvasNode[],
    resultPos: Map<string, { x: number; y: number }>,
    byId: Map<string, CanvasNode>,
  ): Array<{ id: string; patch: Record<string, unknown> }> {
    const entries: Array<{ id: string; patch: Record<string, unknown> }> = []
    // 用引擎算出的绝对坐标构造子节点快照（避免读 store 旧相对坐标）
    const childrenAbs = childNodes
      .map((c) => {
        const pos = resultPos.get(c.id)
        const size = absoluteRectOf(c)
        if (!pos) return null
        return { id: c.id, position: pos, size: { w: size.w, h: size.h } }
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
    const frame = calculateGroupFrameFromAbsoluteChildren(childrenAbs)
    if (!frame) return entries

    // 组本身若有父链（多层分组）：引擎只在顶层平铺，故组 frame 也是"绝对"，若组有父需转相对。
    // v2 plugin-group 只建顶层组，组无父是常态；此处若发现组有父，转相对父坐标。
    let gx = frame.x
    let gy = frame.y
    if (groupNode.parentId) {
      const parentAbs = absoluteRectOf(groupNode)
      // 无法单独定位父，保守：仍按绝对写（保持向后一致）—— plugin-group 不产生嵌套，此分支为防御。
    }
    entries.push({
      id: groupNode.id,
      patch: {
        position: { x: gx, y: gy },
        size: { w: frame.w, h: frame.h },
        data: { ...groupNode.data, cardWidth: frame.w, cardHeight: frame.h },
      },
    })
    for (const c of childrenAbs) {
      const rel = { x: c.position.x - gx, y: c.position.y - gy }
      entries.push({ id: c.id, patch: { position: rel, parentId: groupNode.id } })
    }
    return entries
  }

  /** 执行自动布局（一次原子历史） */
  function run(): boolean {
    const { layoutNodes, edges, groups } = buildLayoutInput()
    if (layoutNodes.length === 0) return false

    // 每次执行现读面板现值：改了方向/间距立刻反映到本次布局结果
    const runConfig = currentConfig()
    if (runConfig.debug) {
      console.log('[auto-layout] input', {
        nodes: layoutNodes.map((n) => ({ id: n.id, type: n.type, size: n.size })),
        groups: groups.map((g) => ({ id: g.id, nodeIds: [...g.nodeIds] })),
      })
    }

    const result = runAutoLayout({ nodes: layoutNodes, edges, groups, config: runConfig })

    // 结果绝对坐标表
    const resultPos = new Map<string, { x: number; y: number }>()
    for (const n of result.nodes) resultPos.set(n.id, { ...n.position })

    // 组装写回 entries
    const byId = new Map(nodeStore.getNodes().map((n) => [n.id, n]))
    const entries: Array<{ id: string; patch: Record<string, unknown> }> = []
    const groupChildIds = new Set<string>()
    const { groups: groupList } = collectGroups()
    for (const g of groupList) {
      const pos = resultPos.get(g.groupNode.id)
      if (g.children.length > 0 && pos) {
        entries.push(...updateGroupAfterLayout(g.groupNode, g.children, resultPos, byId))
        for (const c of g.children) groupChildIds.add(c.id)
      }
    }
    // 自由节点（非组、非组内子）：绝对坐标写回
    for (const n of result.nodes) {
      if (byId.get(n.id)?.type === GROUP_NODE_TYPE) continue
      if (groupChildIds.has(n.id)) continue
      const patch: Record<string, unknown> = { position: { ...n.position } }
      entries.push({ id: n.id, patch })
    }

    // 统一走 graph：一次批量写回位置/尺寸（历史 + 提交落盘）
    graph.updateNodes(
      entries.map((e) => ({
        id: e.id,
        patch: e.patch as { position?: { x: number; y: number }; size?: { w: number; h: number }; data?: Record<string, unknown>; parentId?: string | undefined },
      })),
    )

    if (runConfig.debug) {
      console.log('[auto-layout] logs\n' + result.logs.join('\n'))
    }

    // 布局后居中视口到结果中心（保留 zoom，对齐老版 keepZoom 行为）
    const centerNodes = result.nodes
      .map((n) => byId.get(n.id))
      .filter((n): n is CanvasNode => Boolean(n))
    if (centerNodes.length > 0) {
      focusBounds(centerNodes, { keepZoom: true })
    }
    return true
  }

  // —— 命令 ——
  ctx.commands.register({
    id: 'auto-layout:run',
    title: '自动布局',
    keys: ['mod+l'],
    group: 'auto-layout',
    order: 10,
    run: () => run(),
  })
  ctx.commands.register({
    id: 'auto-layout:focus-selected',
    title: '聚焦选中节点',
    keys: ['f'],
    group: 'auto-layout',
    order: 20,
    run: () => focusSelected(),
  })
  ctx.commands.register({
    id: 'auto-layout:fit-view',
    title: '适应视图',
    keys: ['r'],
    group: 'auto-layout',
    order: 30,
    run: () => viewport.fitView(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const autoLayoutPlugin: PluginModule = { name, inject, Config, apply }
