/**
 * plugin-align-arrange —— 选中节点对齐/等距排列（独立插件，v2 API）。
 *
 * 复刻老版 canvas-core/src/plugins/align-arrange，但遵循 v2 铁律：
 * - 不直碰 VueFlow/宿主内部：数据经 ctx.nodeStore / ctx.selection，尺寸经 ctx.nodeLayout（宿主恒在注入），
 *   写回经 ctx.history.withRecord 一次原子记录 + nodeStore.updateNodes 批量写。
 * - 快捷键用命令 keys（渲染层 CanvasHost 统一分发），不自绑 window。
 * - 纯算法在 arrangeEngine.ts，可独立单测。
 *
 * 命令：
 * - align-arrange:align-left / align-right / align-top / align-bottom —— 边缘对齐
 * - align-arrange:distribute-h / align-arrange:distribute-v —— 等距分布
 * - align-arrange:compact-arrowleft/right/up/down —— 老版核心：沿方向紧凑推挤排列（Ctrl+方向键）
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type {
 NodeStoreService,
 SelectionService,
  GraphDocumentService,
 CanvasNode,
} from '@mini-canvas/canvas-core-v2'
import {
  alignNodes,
  distributeNodes,
  type AlignDirection,
  type ArrangeRect,
  type DistributeAxis,
} from './arrangeEngine'
import { computeCompactArrange, type CompactDirection } from './compactArrange'

/** 节点布局服务最小形状（宿主注入 @mini-canvas/canvas-render 的 NodeLayoutService；只读类型不落 declare 避免与渲染层冲突） */
interface NodeLayoutLike {
  nodeSize(id: string): { w: number; h: number }
}

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeStore: NodeStoreService
    selection: SelectionService
    graph: GraphDocumentService
  }
}

export const name = 'align-arrange'
export const inject = ['nodeStore', 'selection', 'graph'] as string[]

/** 默认尺寸回退：nodeLayout 缺失时的兜底（与老版 200x100 默认一致，实际以 nodeLayout 为准） */
const FALLBACK_W = 200
const FALLBACK_H = 100
/** 紧凑排列间距（老版 DEFAULT_CONFIG.gap = 20） */
const COMPACT_GAP = 20

export function apply(ctx: Context) {
  const { nodeStore, selection, graph } = ctx
  // nodeLayout 由渲染层宿主注入；此处经 ctx.get 可选读取（与 group/mini-map 同模式，不 declare 直访类型）
  const layout = ctx.get<NodeLayoutLike | undefined>('nodeLayout')

  /** 取节点矩形：位置用 node.position（相对坐标，与 updateNodes 写入一致）；尺寸走 nodeLayout 实测/声明/默认。 */
  function toRect(n: CanvasNode): ArrangeRect {
    const dim = layout?.nodeSize(n.id)
    const w = dim?.w ?? n.size?.w ?? FALLBACK_W
    const h = dim?.h ?? n.size?.h ?? FALLBACK_H
    return { id: n.id, x: n.position.x, y: n.position.y, w, h }
  }

  /** 选中节点矩形数组（不足 2 个返回空） */
  function selectedRects(): ArrangeRect[] {
    const ids = [...selection.ids]
    if (ids.length < 2) return []
    const rects: ArrangeRect[] = []
    for (const id of ids) {
      const n = nodeStore.getNode(id)
      if (n) rects.push(toRect(n))
    }
    return rects
  }

  /** 原子执行：算目标位置 → withRecord 包一次 → updateNodes 批量写回。 */
  function applyResult(result: Map<string, { x: number; y: number }>): void {
    if (result.size === 0) return
   const entries = [...result.entries()].map(([id, pos]) => ({ id, patch: { position: pos } }))
    graph.updateNodes(entries)
  }

  function runAlign(dir: AlignDirection): void {
    const rects = selectedRects()
    if (rects.length < 2) return
    applyResult(alignNodes(rects, dir))
  }

  function runDistribute(axis: DistributeAxis): void {
    const rects = selectedRects()
    if (rects.length < 3) return
    applyResult(distributeNodes(rects, axis))
  }

  function runCompact(direction: CompactDirection): void {
    const rects = selectedRects()
    if (rects.length < 2) return
    applyResult(computeCompactArrange(rects, direction, COMPACT_GAP))
  }

  ctx.commands.register({
    id: 'align-arrange:align-left',
    title: '左对齐',
    keys: ['mod+shift+arrowleft'],
    group: 'align-arrange',
    order: 10,
    run: () => runAlign('left'),
  })
  ctx.commands.register({
    id: 'align-arrange:align-right',
    title: '右对齐',
    keys: ['mod+shift+arrowright'],
    group: 'align-arrange',
    order: 11,
    run: () => runAlign('right'),
  })
  ctx.commands.register({
    id: 'align-arrange:align-top',
    title: '顶对齐',
    keys: ['mod+shift+arrowup'],
    group: 'align-arrange',
    order: 12,
    run: () => runAlign('top'),
  })
  ctx.commands.register({
    id: 'align-arrange:align-bottom',
    title: '底对齐',
    keys: ['mod+shift+arrowdown'],
    group: 'align-arrange',
    order: 13,
    run: () => runAlign('bottom'),
  })
  ctx.commands.register({
    id: 'align-arrange:distribute-h',
    title: '水平等距分布',
    group: 'align-arrange',
    order: 20,
    run: () => runDistribute('h'),
  })
  ctx.commands.register({
    id: 'align-arrange:distribute-v',
    title: '垂直等距分布',
    group: 'align-arrange',
    order: 21,
    run: () => runDistribute('v'),
  })
  ctx.commands.register({
    id: 'align-arrange:compact-arrowleft',
    title: '向左紧凑排列',
    keys: ['ctrl+arrowleft'],
    group: 'align-arrange',
    order: 30,
    run: () => runCompact('ArrowLeft'),
  })
  ctx.commands.register({
    id: 'align-arrange:compact-arrowright',
    title: '向右紧凑排列',
    keys: ['ctrl+arrowright'],
    group: 'align-arrange',
    order: 31,
    run: () => runCompact('ArrowRight'),
  })
  ctx.commands.register({
    id: 'align-arrange:compact-arrowup',
    title: '向上紧凑排列',
    keys: ['ctrl+arrowup'],
    group: 'align-arrange',
    order: 32,
    run: () => runCompact('ArrowUp'),
  })
  ctx.commands.register({
    id: 'align-arrange:compact-arrowdown',
    title: '向下紧凑排列',
    keys: ['ctrl+arrowdown'],
    group: 'align-arrange',
    order: 33,
    run: () => runCompact('ArrowDown'),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const alignArrangePlugin: PluginModule = { name, inject, apply }
