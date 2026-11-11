/**
 * paramKind —— 「参数声明 → 用哪个控件画」的**唯一映射处**（纯函数，node 可单测）。
 *
 * 分工（2026-11-08 定）：
 * - **基础控件**：`type` 表达，覆盖绝大多数需求 —— 下拉 / 按钮网格 / 文本 /
 *   数字（滑块 + 数字框）/ 开关。它们不是「预设件」，就是普通控件。
 * - **专属 UI**：`kind` 表达，只留给基础控件画不出来的东西。现在只有 `ratio`
 *   （按真实宽高比画小矩形的网格）。
 *
 * 为什么把「画质 / 分辨率 / 数量 / 运镜」这些 kind 删掉：它们本来就只是一个按钮网格，
 * 与 `type: 'grid'` 画出来的东西一模一样。留着等于同一个 UI 有两个入口，
 * 文档要写两遍、作者要猜该用哪个，而且加一个新语义就得改内核词表。
 *
 * 优先级（与 ToolParamField 的渲染顺序一致）：
 * 1. 作者自带 `component` → 交给他（逃生口，永远最优先）；
 * 2. `kind: 'ratio'` → 比例网格；
 * 3. 其余按 `type` 画基础控件。
 */
import type { ToolParamDef } from '@plume-canvas/kernel'

/** 专属 UI 的形态（与 ui 目录里登记的名字一一对应） */
export type PresetKind = 'ratio'

/** 按钮类控件自动排一行时最多几列：超过就折行 */
const AUTO_COLUMNS_MAX = 6

/**
 * 该参数是否**带范围**（只有带范围才画滑块）。
 *
 * 不能写成「type 是 number 就算」：无范围的 number（如随机种子）应该是普通数字输入框，
 * 硬套滑块会没有刻度、拖起来毫无意义。
 */
function hasRange(param: ToolParamDef): boolean {
  return param.min !== undefined || param.max !== undefined
}

/**
 * 判定一个参数要不要用**专属 UI**。
 *
 * @returns 专属形态；`undefined` = 用基础控件（不是错误，是常态）
 */
export function resolvePresetKind(param: ToolParamDef): PresetKind | undefined {
  // 优先级 1：作者自带组件，什么都不抢
  if (param.component) return undefined

  // 比例：带按真实宽高比画的小矩形，基础下拉表达不了这个信息
  if (param.kind === 'ratio') return (param.options?.length ?? 0) > 0 ? 'ratio' : undefined

  return undefined
}

/** 基础控件的形态 */
export type BaseControl = 'select' | 'grid' | 'slider' | 'number' | 'text' | 'boolean'

/**
 * 判定一个参数该用哪种**基础控件**。
 *
 * 顺序有意义：`number` 带 `options` 时先判成网格 —— 语义是「从几档里选一个」
 * （5 秒 / 10 秒这种），点按钮比拖滑块快。
 */
export function resolveBaseControl(param: ToolParamDef): BaseControl {
  if (param.type === 'grid') return 'grid'
  if (param.type === 'number' && (param.options?.length ?? 0) > 0) return 'grid'
  if (hasRange(param)) return 'slider'
  if (param.type === 'select') return 'select'
  if (param.type === 'boolean') return 'boolean'
  if (param.type === 'number') return 'number'
  return 'text'
}

/**
 * 按钮类控件是不是**自己画标题**。
 *
 * 用途：外层 `ToolParamGroup` 只在「控件自己不画标题」时补一行标题。
 * 按钮网格与比例网格都在块内画 h4，外层再画一遍就是两个标题。
 */
export function drawsOwnTitle(param: ToolParamDef): boolean {
  return resolvePresetKind(param) === 'ratio' || resolveBaseControl(param) === 'grid'
}

/**
 * 专属 UI 在 ui 目录里的登记名（`useUiComponent` 按此取值）。
 *
 * 为什么走目录而不是直接 import：业务插件不该依赖主题包（T08 守卫），
 * 而专属 UI 属于「会被主题整体换掉」的设计系统件 —— 目录是唯一正确的通道。
 */
export const PRESET_UI_NAMES: Record<PresetKind, string> = {
  ratio: 'toolParamRatio',
}

/**
 * 「唯一的一个参数、而且它就是个普通下拉」→ 直接铺到外面，不再套一层参数面板。
 *
 * 两条限制（缺一条都会把不该铺开的东西铺开）：
 * 1. **恰好一项** —— 两个以上参数必须收面板，否则底行会被撑爆；
 * 2. **是普通下拉** —— 按钮网格 / 滑块 / 比例网格需要整块版面，硬铺进底行会挤成一条；
 *    作者自带的 `component` 同理。
 *
 * @returns 该铺到外面的那个参数；不该铺时返回 `undefined`
 */
export function resolveInlineSoleSelect(params: ReadonlyArray<ToolParamDef>): ToolParamDef | undefined {
  if (params.length !== 1) return undefined
  const p = params[0]
  if (p.component) return undefined
  if (resolvePresetKind(p) !== undefined) return undefined
  if (resolveBaseControl(p) !== 'select') return undefined
  return p
}

/**
 * 按钮类控件的列数。
 *
 * 优先级：作者显式给的 `columns` > 按选项数排一行（最多 6 列）> 3 列兜底。
 *
 * 作者为什么要能给：6 档比例刚好一行，但 12 档比例排一行每格只剩 30px；
 * 反过来两个字的选项（「低 / 中 / 高」）铺成 3 列很宽、铺成 1 列反而清楚。
 * 这类「怎么排更好看」只有写 provider 的人知道。
 *
 * @param optionCount 选项个数；0 表示未知（用兜底列数）
 */
export function gridColumns(param: ToolParamDef, optionCount = 0): number {
  const want = Number(param.columns)
  if (Number.isFinite(want) && want >= 1) return Math.floor(want)
  if (optionCount <= 0) return 3
  return Math.min(optionCount, AUTO_COLUMNS_MAX)
}

