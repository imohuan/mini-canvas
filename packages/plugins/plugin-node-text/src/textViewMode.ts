/**
 * textViewMode —— 文本节点「预览 / 缩略横条 / 编辑」三态的判定（纯函数，零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户要求（原话）：
 * - 默认只显示内容，**超出就裁掉**（预览态，不给滚动条）；
 * - **双击**才进入编辑态，编辑态**要给滚动条**（内容长了能在框里滚）；
 * - 编辑态要**拦下滚轮**，否则滚轮会被画布吃掉去缩放画面，用户就没法滚自己的文字；
 * - 「当鼠标缩放到一定程度下，文本会发生一些改变。我希望你可以改变成图片中的这种形式，
 *   使用不同长度的矩形色块」—— 即缩略态不再是"一块灰底"，而是**骨架屏**（长短不一的色块）。
 *   追问「两档都改吗」→「两档都改成横条」。
 *
 * 抽成纯函数的原因与其它纯逻辑模块一致：这些判定是"看代码看不出来对不对"的那一类，
 * 放 Node 里直接断言成本几乎为零；写在 .vue 的 computed 里就只能靠肉眼。
 *
 * 与 v1 的关系：缩放分级沿用 v1 TextNode.vue 的阈值语义（full / condensed / icon 三档），
 * 只是把缩略的两档都换成了骨架横条（见 textSkeleton.ts），并明确"编辑态优先"——
 * 用户双击进来就是要编辑，不该因为画布缩得小就把他挡在外面（v1 是直接拒绝进入编辑）。
 */

/** 内容形态：预览全文 / 骨架横条（两档密度）/ 编辑中 */
export type TextContentMode = 'preview' | 'skeleton' | 'skeleton-mini' | 'editing'

/** 当前内容该怎么渲染（模板直接照它分叉，不再自己判条件） */
export interface TextContentSpec {
  mode: TextContentMode
  /** 是否允许滚动（预览与编辑可滚；缩略态一律裁掉） */
  scrollable: boolean
  /** 是否需要把滚轮从画布手里抢过来（预览与编辑抢，缩略态还给画布） */
  blockCanvasWheel: boolean
}

/** 判定输入：编辑态标志 + 当前缩放 + 两个分级阈值 */
export interface TextContentInput {
  /** 是否处于编辑态（双击进入） */
  editing: boolean
  /** 当前画布缩放（viewport.zoom） */
  zoom: number
  /** 高于等于它按全文显示 */
  fullZoom: number
  /** 低于它换更小的一档骨架横条 */
  iconZoom: number
}

/**
 * 算出当前该用哪种内容形态。
 *
 * 优先级：编辑态 > 缩略横条（更小档）> 缩略横条 > 全文预览。
 *
 * 预览态也可滚：用户 2026-10-29 对照参考稿确认「不选中、不编辑也能滚」，
 * 所以滚动与编辑解耦。预览仍**不弹** textarea，双击才编辑；
 * 拖拽节点由 nodrag/nopan 的缺失 + nowheel 只拦 wheel 保证（见 TextContent 模板）。
 * zoom 非法（NaN / 非有限数）时按常态处理 —— 宁可正常显示，也不要把内容变成占位。
 */
export function resolveTextContentSpec(input: TextContentInput): TextContentSpec {
  if (input.editing) return { mode: 'editing', scrollable: true, blockCanvasWheel: true }

  const zoom = Number.isFinite(input.zoom) ? input.zoom : Number.POSITIVE_INFINITY
  if (zoom < input.iconZoom) return { mode: 'skeleton-mini', scrollable: false, blockCanvasWheel: false }
  if (zoom < input.fullZoom) return { mode: 'skeleton', scrollable: false, blockCanvasWheel: false }
  return { mode: 'preview', scrollable: true, blockCanvasWheel: true }
}

/** 该形态是不是"骨架横条"（模板要拿它分叉） */
export function isSkeletonMode(mode: TextContentMode): boolean {
  return mode === 'skeleton' || mode === 'skeleton-mini'
}

/**
 * 把两个可配阈值收敛成"能用的分级边界"，与 v1 同款下限：
 * full 不低于 0.2、icon 不低于 0.05。阈值缺失/非法时用传入的兜底默认值。
 */
export function resolveLodThresholds(
  titleScaleMinZoom: unknown,
  textLodIconZoom: unknown,
  defaults = { fullZoom: 0.5, iconZoom: 0.18 },
): { fullZoom: number; iconZoom: number } {
  const full = numOr(titleScaleMinZoom, defaults.fullZoom)
  const icon = numOr(textLodIconZoom, defaults.iconZoom)
  return { fullZoom: Math.max(full, 0.2), iconZoom: Math.max(icon, 0.05) }
}

/** 只认有限数，其余回落默认（配置被改坏时不至于让整条分级失效） */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

