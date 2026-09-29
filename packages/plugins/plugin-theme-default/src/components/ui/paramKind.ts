/**
 * paramKind —— 「参数语义类型 → 预设组件」的**唯一映射处**（纯函数，node 可单测）。
 *
 * 用户的原话：`我会识别到某些固定的一些类型参数，它就会使用我的预设组件`。
 * 这个文件就是那层"识别"：工具作者只声明参数**是什么东西**（kind: 'ratio' / 'duration' / …），
 * 由这里决定用哪个预设件渲染，工具作者与节点插件都不必写 UI。
 *
 * 为什么规则住在这里而不是散进 ToolParamField 的条件分支：
 * 分支散开之后没法单测、也没法一眼看出"哪类参数落哪个件"；收成一张判定表才可核对。
 *
 * 三条优先级（与 ToolParamField 的渲染顺序一致）：
 * 1. 作者自带 `component` → 交给他（逃生口，永远最优先）；
 * 2. 声明了 `kind` 且本表认得 → 对应预设件；
 * 3. 其余（没声明 / 认不得 / 预设件表达不了）→ 回落内置 type 控件。
 */
import type { ToolParamDef } from '@mini-canvas/kernel'

/** 预设件的三种形态（与 ui 目录里登记的名字一一对应，见 presetComponent） */
export type PresetKind = 'ratio' | 'grid' | 'slider'

/** 语义类型 → 按钮网格（参考站的"画质/清晰度/背景/生成数量"那一排） */
const GRID_KINDS = new Set(['quality', 'resolution', 'background', 'count', 'camera'])
/** 语义类型 → 滑块（数值区间，要拖） */
const SLIDER_KINDS = new Set(['speed'])
/** 语义类型 → 明确**不**用预设件（选项多、文字长，下拉才合适；参考站也是单独的按钮/下拉） */
const DROPDOWN_KINDS = new Set(['model', 'style', 'speaker', 'format'])

/** 该参数是不是数值型（有范围或声明成 number） */
function isNumeric(param: ToolParamDef): boolean {
  return param.type === 'number' || param.min !== undefined || param.max !== undefined
}

/** 选项够少 = 直接铺成按钮（2 档时长比一根滑块好点，一眼可选） */
const GRID_MAX_OPTIONS = 3

/**
 * 判定一个参数该用哪个预设件。
 * @returns 预设件形态；`undefined` = 回落内置控件（不是错误，是正常的"表达不了"）
 */
export function resolvePresetKind(param: ToolParamDef): PresetKind | undefined {
  // 优先级 1：作者自带组件
  if (param.component) return undefined

  const kind = typeof param.kind === 'string' ? param.kind : ''
  if (!kind) return undefined

  // 比例：专用网格（带按真实宽高比画的小图标）
  if (kind === 'ratio') return (param.options?.length ?? 0) > 0 ? 'ratio' : undefined

  // 画质 / 清晰度 / 背景 / 数量 / 运镜：一排按钮
  if (GRID_KINDS.has(kind)) return (param.options?.length ?? 0) > 0 ? 'grid' : undefined

  // 时长：档位少（<=3 档，如 dola 的 5/10）铺按钮；否则拖滑块
  if (kind === 'duration') {
    const count = param.options?.length ?? 0
    if (count > 0) return count <= GRID_MAX_OPTIONS ? 'grid' : 'slider'
    return isNumeric(param) ? 'slider' : undefined
  }

  // 语速这类数值区间：滑块
  if (SLIDER_KINDS.has(kind)) return isNumeric(param) ? 'slider' : undefined

  // 模型 / 风格 / 音色 / 格式：明确回落下拉（选项多、名字长，网格放不下）
  if (DROPDOWN_KINDS.has(kind)) return undefined

  // 认不得的 kind：不猜，回落内置控件
  return undefined
}

/**
 * 预设件在 ui 目录里的登记名（`useUiComponent` 按此取值）。
 * 为什么走目录而不是直接 import：业务插件不该依赖主题包（T08 守卫），
 * 而预设件属于"会被主题整体换掉"的设计系统件 —— 目录是唯一正确的通道。
 */
export const PRESET_UI_NAMES: Record<PresetKind, string> = {
  ratio: 'toolParamRatio',
  grid: 'toolParamGrid',
  slider: 'toolParamSlider',
}

/** 该预设件的默认列数（照参考站实测：比例 5 列，其余 3 列） */
export function presetColumns(kind: PresetKind): number {
  return kind === 'ratio' ? 5 : 3
}
