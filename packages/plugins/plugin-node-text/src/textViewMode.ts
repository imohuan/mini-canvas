/**
 * textViewMode —— 文本节点「预览 / 编辑」两态的判定（纯函数，零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户要求（原话）：
 * - 默认只显示内容，**超出就裁掉**（预览态，不给滚动条）；
 * - **双击**才进入编辑态，编辑态**要给滚动条**（内容长了能在框里滚）；
 * - 编辑态要**拦下滚轮**，否则滚轮会被画布吃掉去缩放画面，用户就没法滚自己的文字。
 *
 * 抽成纯函数的原因与其它纯逻辑模块一致：这些判定是"看代码看不出来对不对"的那一类，
 * 放 Node 里直接断言成本几乎为零；写在 .vue 的 computed 里就只能靠肉眼。
 *
 * 与 v1 的关系：三档缩放分级（full → condensed 首行截断 → icon 缩略占位）沿用 v1
 * TextNode.vue 的阈值语义，只是把"编辑态优先"这条明确了 —— 用户双击进来就是要编辑，
 * 不该因为画布缩得小就把他挡在外面（v1 是直接拒绝进入编辑）。
 */

/** 内容形态：预览全文 / 预览首行 / 缩略占位 / 编辑中 */
export type TextContentMode = 'preview' | 'preview-condensed' | 'icon' | 'editing'

/** 当前内容该怎么渲染（模板直接照它分叉，不再自己判条件） */
export interface TextContentSpec {
  mode: TextContentMode
  /** 是否允许滚动（只有编辑态给滚动条；预览态一律裁掉） */
  scrollable: boolean
  /** 是否需要把滚轮从画布手里抢过来（只有编辑态抢） */
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
  /** 低于它只显示缩略占位 */
  iconZoom: number
}

/**
 * 算出当前该用哪种内容形态。
 *
 * 优先级：编辑态 > 缩略占位 > 首行截断 > 全文预览。
 * zoom 非法（NaN / 非有限数）时按常态处理 —— 宁可正常显示，也不要因为一个坏数值把内容变成占位。
 */
export function resolveTextContentSpec(input: TextContentInput): TextContentSpec {
  if (input.editing) return { mode: 'editing', scrollable: true, blockCanvasWheel: true }

  const zoom = Number.isFinite(input.zoom) ? input.zoom : Number.POSITIVE_INFINITY
  if (zoom < input.iconZoom) return { mode: 'icon', scrollable: false, blockCanvasWheel: false }
  if (zoom < input.fullZoom) return { mode: 'preview-condensed', scrollable: false, blockCanvasWheel: false }
  return { mode: 'preview', scrollable: false, blockCanvasWheel: false }
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
