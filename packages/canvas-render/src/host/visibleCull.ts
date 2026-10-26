/**
 * visibleCull —— 可见节点判定（性能优化主逻辑，零 Vue / 零 DOM，纯函数可单测）。
 *
 * 背景（2026-10-15 性能诊断）：160 节点拖动时每帧 70ms（14FPS），瓶颈是浏览器渲染准备作业
 * （样式/布局/滤镜）随**节点总数**线性增长。原方案：视口外节点 hidden=true。
 *
 * 2026-10-26 hidden 路线退役（docs/plan/2026-10-26-node-visibility-states.md）：
 * VueFlow EdgeWrapper 对任一端 hidden 的边 render null —— 连线跟着节点消失（用户实测断线）。
 * 本文件保留，职责改为**产出视口内 id 集合**，由宿主派生 data._cullState
 * （visible / culled / culled-linked），节点一律常驻，绘制深度由壳按状态自选。
 *
 * 零例外规则（与用户逐条对齐，2026-10-15）：所有节点——普通/分组父/被选中/拖拽中——
 * 一律走同一相交判定，不做特判。理由：
 * - 选中是数据态（内核 Selection），选中框算数据坐标（nodeLayout.getNodeRect），
 *   不依赖 DOM——实测隐藏 30 个屏外节点选中框坐标不变；
 * - 多选拖拽时成员会散布视口外（用户纠正），不需要渲染也能正常工作，
 *   缓冲带保证滚回视野时已在渲染；
 * - 分组子节点在父框内：子命中 ⇒ 父必命中，自然满足判定。
 *
 * 判定坐标必须是**绝对坐标**：nodeLayout.getAllRects() 已累加父链位移
 * （absolutePosition），分组子节点不会像 VueFlow 自带剔除那样被误判
 * （那个 bug 的真实机理是时序：parseNode 初始 computedPosition 为相对坐标 + 卸载子树
 * watcher 停转后位置过期——见诊断报告 §9.1 E3，提交 60a50bf5 因此移除了库级开关）。
 */
import type { FlowRect } from '../geometry/visibleArea'
import { expandRect, rectsOverlap } from '../geometry/visibleArea'
import type { LayoutRect, NodeLayoutService } from '../layout/nodeLayout'

/** 剔除配置（设置面板「常规/画布」分组，用户可调） */
export interface VisibleCullConfig {
  /** 总开关：false 时所有节点 hidden=false（现状行为） */
  enabled: boolean
  /** 缓冲距离（flow 像素）：视口外扩这么远内的节点仍渲染，防拖动闪白 + 兜住滚回窗口 */
  buffer: number
}

export const VISIBLE_CULL_DEFAULTS: VisibleCullConfig = {
  enabled: true,
  buffer: 300,
}

/** 可见性判定（核心纯函数）：
 * 给定视口矩形与配置，返回"应渲染"判定函数或 null（禁用时）。
 * rect 由调用方从 nodeLayout 取（绝对坐标 + 实测尺寸）。 */
export function makeVisiblePredicate(
  viewportRect: FlowRect | null,
  config: VisibleCullConfig,
): ((rect: LayoutRect) => boolean) | null {
  if (!config.enabled || !viewportRect) return null
  const area = expandRect(viewportRect, Math.max(0, config.buffer))
  return (rect: LayoutRect) => rectsOverlap(rect, area)
}

/**
 * 批量判定哪些节点可见：返回可见 id 集合。
 * layout = host.nodeLayout（getAllRects 数据层全量、绝对坐标）。
 * viewportRect 为 null（未挂载/量不到 pane）→ 返回 null 表示"全量渲染"（安全兜底）。
 */
export function computeVisibleIds(
  layout: NodeLayoutService,
  viewportRect: FlowRect | null,
  config: VisibleCullConfig,
): Set<string> | null {
  const predicate = makeVisiblePredicate(viewportRect, config)
  if (!predicate) return null
  const ids = new Set<string>()
  for (const rect of layout.getAllRects()) {
    if (predicate(rect)) ids.add(rect.id)
  }
  return ids
}
