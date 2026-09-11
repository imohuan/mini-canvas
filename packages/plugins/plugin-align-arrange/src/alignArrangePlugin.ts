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
import type { ConfigSchema, Context, InferConfig, PluginModule } from '@mini-canvas/canvas-base'
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
import { computeCompactArrange, type CompactDirection, type CompactSpacing } from './compactArrange'

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
/** 紧凑排列间距兜底（老版 DEFAULT_CONFIG.gap = 20；面板改过则以面板值为准） */
const DEFAULT_COMPACT_GAP = 20

/**
 * Config schema（标量字段登记 ⚙ 设置面板；group 用 `一级/二级` 分层）。
 *
 * 分组（用户反馈）：本插件的间距项与 plugin-auto-layout 同住「布局/自动布局方向」这一格，
 * 不再单独立一个「方向键排列」二级页签；靠 label/description 点明各自是 Ctrl+方向键还是 Ctrl/Cmd+L。
 *
 * 间距分 X / Y 两轴：紧凑排列是沿一个方向推挤，左右排列沿 X 轴推开、上下排列沿 Y 轴推开，
 * 两个方向需要的间隙各调各的（此前共用一个值，用户反馈要拆开）。
 *
 * 注意：settings 的 key 是**全局平面命名**（跨插件同名会被先声明者占位丢弃），故本插件 key 一律加
 * `alignArrange` 前缀，避免与 auto-layout 的 direction/debug 等撞名（内核会跳过重复声明的 key）。
 */
export const Config = {
  alignArrangeGapX: {
    type: 'number',
    default: DEFAULT_COMPACT_GAP,
    min: 0,
    max: 100,
    step: 1,
    label: '水平间距（左右排列）',
    group: '布局/自动布局方向',
    description:
      '【Ctrl+← / Ctrl+→】左右推挤排列时，节点之间沿 X 轴保留的间隙（px）。调大左右排开得更松。' +
      '（与「自动布局间距」无关：那个管 Ctrl/Cmd+L 的整体布局，这个只管方向键推挤。）',
  },
  alignArrangeGapY: {
    type: 'number',
    default: DEFAULT_COMPACT_GAP,
    min: 0,
    max: 100,
    step: 1,
    label: '垂直间距（上下排列）',
    group: '布局/自动布局方向',
    description: '【Ctrl+↑ / Ctrl+↓】上下推挤排列时，节点之间沿 Y 轴保留的间隙（px）。调大上下排开得更松。',
  },
  alignArrangeDebug: {
    type: 'boolean',
    default: false,
    label: '方向键排列诊断日志',
    group: '布局/诊断',
    description:
      '打开后，每次对齐/等距/Ctrl+方向键紧凑排列会在控制台打印参与节点与结果，便于排查是否符合预期（区别于自动布局的诊断日志）。',
  },
} satisfies ConfigSchema

export type AlignArrangeConfigFromSchema = InferConfig<typeof Config>

export function apply(ctx: Context, rawConfig?: Partial<AlignArrangeConfigFromSchema>) {
  const { nodeStore, selection, graph } = ctx
  // nodeLayout 由渲染层宿主注入；此处经 ctx.get 可选读取（与 group/mini-map 同模式，不 declare 直访类型）
  const layout = ctx.get<NodeLayoutLike | undefined>('nodeLayout')

  // ⚙ 设置面板单一数据源（内置恒在）。每次执行命令**实时**读它 —— 面板改过立刻生效，
  // 不能把 apply 时的 config 冻结成闭包常量（那样改了间距/日志开关都不生效）。
  const settings = ctx.get<{ get(key: string): string | number | boolean | undefined } | undefined>('settings')
  const readSetting = <T extends string | number | boolean>(key: string, fallback: T): T => {
    const v = settings?.get(key)
    return (v === undefined || v === null ? fallback : v) as T
  }
  /** 当前紧凑排列间距（按轴；面板现值优先，未改回落 schema 默认） */
  function compactSpacing(): CompactSpacing {
    return {
      x: readSetting('alignArrangeGapX', DEFAULT_COMPACT_GAP),
      y: readSetting('alignArrangeGapY', DEFAULT_COMPACT_GAP),
    }
  }
  /** 当前诊断开关 */
  function debugOn(): boolean {
    return readSetting('alignArrangeDebug', rawConfig?.alignArrangeDebug ?? false)
  }

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
    const result = alignNodes(rects, dir)
    if (debugOn()) {
      // eslint-disable-next-line no-console
      console.log(`[align-arrange] 对齐 ${dir}`, {
        selected: rects.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        moved: [...result.entries()].map(([id, pos]) => ({ id, ...pos })),
      })
    }
    applyResult(result)
  }

  function runDistribute(axis: DistributeAxis): void {
    const rects = selectedRects()
    if (rects.length < 3) return
    const result = distributeNodes(rects, axis)
    if (debugOn()) {
      // eslint-disable-next-line no-console
      console.log(`[align-arrange] 等距分布 ${axis}`, {
        selected: rects.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        moved: [...result.entries()].map(([id, pos]) => ({ id, ...pos })),
      })
    }
    applyResult(result)
  }

  function runCompact(direction: CompactDirection): void {
    const rects = selectedRects()
    if (rects.length < 2) return
    const spacing = compactSpacing()
    const result = computeCompactArrange(rects, direction, spacing)
    if (debugOn()) {
      // 本次实际生效的那一轴（左右排列取 x、上下排列取 y），日志里标清楚便于排查
      const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight'
      const gap = horizontal ? spacing.x : spacing.y
      // eslint-disable-next-line no-console
      console.log(`[align-arrange] 紧凑排列 ${direction} gap=${gap}(${horizontal ? 'x' : 'y'})`, {
        selected: rects.map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        moved: [...result.entries()].map(([id, pos]) => ({ id, ...pos })),
      })
    }
    applyResult(result)
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

/** 兼容旧装配的 PluginModule 出口（Config 随模块声明：内核装配时校验 + 补默认 + 登记设置面板） */
export const alignArrangePlugin: PluginModule = { name, inject, Config, apply }
