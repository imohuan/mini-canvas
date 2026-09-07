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
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type {
  NodeStoreService,
  SelectionService,
  HistoryService,
  CanvasNode,
} from '@mini-canvas/canvas-core-v2'
import {
  alignNodes,
  distributeNodes,
  type AlignDirection,
  type ArrangeRect,
  type DistributeAxis,
} from './arrangeEngine'

/** 节点布局服务最小形状（宿主注入 @mini-canvas/canvas-render 的 NodeLayoutService；声明只读避免硬依赖） */
interface NodeLayoutLike {
  nodeSize(id: string): { w: number; h: number }
}

declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    nodeStore: NodeStoreService
    selection: SelectionService
    history: HistoryService
    nodeLayout?: NodeLayoutLike
  }
}

export const name = 'align-arrange'
export const inject = ['nodeStore', 'selection', 'history'] as string[]

/** 默认尺寸回退：nodeLayout 缺失时的兜底（与老版 200x100 默认一致，实际以 nodeLayout 为准） */
const FALLBACK_W = 200
const FALLBACK_H = 100

export function apply(ctx: Context) {
  const { nodeStore, selection, history } = ctx
  const layout = ctx.nodeLayout

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
    history.withRecord(() => {
      nodeStore.updateNodes(entries)
    })
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
}

/** 兼容旧装配的 PluginModule 出口 */
export const alignArrangePlugin: PluginModule = { name, inject, apply }
