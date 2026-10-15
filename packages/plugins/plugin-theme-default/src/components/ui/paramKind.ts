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
/**
 * 「档位可能很多、名字还长」的 kind —— 即便眼下只有两三个选项，也仍走下拉。
 *
 * 为什么单列一张表而不是靠选项数量判断：模型名 / 音色名 / 风格名动辄十几个字，
 * 铺成按钮会互相挤成一团省略号（读不出选的是谁）。这几类**永远**交给下拉，
 * 与数量无关。
 */
const LONG_LIST_KINDS = new Set(['model', 'style', 'speaker'])

/**
 * 「选项少」的门槛：到这个数以内就铺成按钮行（切换式），不塞进下拉。
 *
 * 用户口径（2026-10-14）：「像这种选项很少的情况下，可以使用另外一种方式，
 * 就是以切换的方式进行」。三档以内一眼全看得见，点一下就换，比「点开下拉 → 再点一项」
 * 少一半动作（格式 WAV / MP3 / OGG Opus 就是这条的样板）。
 */
const FEW_OPTIONS_MAX = 3

/** 该参数是不是数值型（有范围或声明成 number） */
function isNumeric(param: ToolParamDef): boolean {
  return param.type === 'number' || param.min !== undefined || param.max !== undefined
}

/** 选项够少 = 直接铺成按钮（2 档时长比一根滑块好点，一眼可选） */
const GRID_MAX_OPTIONS = 3

/**
 * 「选项很少的下拉」→ 铺成按钮行（切换式）。
 *
 * 用户口径（2026-10-14）：「我觉得像这种选项很少的情况下，可以使用另外一种方式，
 * 就是以切换的方式进行」。判据 = 这是个下拉参数、且选项数在门槛以内 ——
 * 长名单大类（model / style / speaker）已在上一条被摘走，不会误伤。
 *
 * 为什么按**数量**判、而不是再列一张 kind 白名单：选项少不少是数据事实，
 * 平台给几档就是几档；写死 kind 名单会漏掉（下次冒出一个新 kind 又要改这里）。
 */
function isFewOptionSelect(param: ToolParamDef): boolean {
  if (param.type !== 'select') return false
  const count = param.options?.length ?? 0
  return count >= 1 && count <= FEW_OPTIONS_MAX
}

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

  // 模型 / 风格 / 音色：名字长且可能很多，永远交给下拉（不看数量）
  if (LONG_LIST_KINDS.has(kind)) return undefined

  // 其余 kind 里，**选项少的下拉**（格式 WAV/MP3/OGG 这类）铺成按钮行：
  // 点一下就换，比「点开下拉 → 再点一项」少一半动作。
  if (isFewOptionSelect(param)) return 'grid'

  // 兜底：认不得的 kind / 选项偏多的其它下拉 → 回落内置控件（不猜、不炸）
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

/**
 * 「唯一的一个参数、而且它就是个普通下拉」→ 应把它**直接铺到外面**，不再套一层参数面板。
 *
 * 用户口径（2026-10-14，附图）：「集成在这个下拉菜单里面，没有必要做成这种二级菜单……
 * 你这边的实现好像就是将所有的配置全部集合在里面。那你这边可以做一个判断：
 * 如果里面只有唯一的一项，并且它是下拉的话，就直接把它做成外部的形式」。
 *
 * 为什么单独列这条判定：底栏（`ToolParamGroup` 的宿主）一行里放不下很多个下拉，
 * 所以多参数时才收进面板；**只有一个下拉参数**时收进面板纯属多余 ——
 * 用户要点两次（先开面板、再开下拉）才能改一个值。直接铺到外面点一次就够，
 * 与左边的模型下拉并排，观感也统一（截图中「音色」那一格正是这个场景）。
 *
 * 两条限制（缺一条都会把不该铺开的东西铺开）：
 * 1. **恰好一项** —— 两个以上参数必须收面板，否则底行会被撑爆；
 * 2. **是内置下拉**（`type: 'select'` 且没有预设件形态）—— 滑块 / 按钮网格 / 比例网格
 *    需要整块标题与排版，硬铺进底行会挤成一条；作者自带的 `component` 同理
 *    （它可能是一整块自定义 UI，不是"普通下拉"）。
 *
 * 为什么**不**把长名单大类（`model` / `style` / `speaker`）排除在外：用户的样板恰恰是
 * 「音色」(`kind: 'speaker'`，20+ 项) —— 他说这一格不必再套二层菜单。只有一个下拉时，
 * 底行那格本来就只放它一个，宽度从容；名字过长由字号/省略号与一档最小宽处理（见宿主样式）。
 *
 * @returns 该铺到外面的那个参数；不该铺（0 项 / 多项 / 不是普通下拉）时返回 `undefined`
 */
export function resolveInlineSoleSelect(params: ReadonlyArray<ToolParamDef>): ToolParamDef | undefined {
  if (params.length !== 1) return undefined
  const p = params[0]
  if (p.type !== 'select') return undefined
  // 作者自带组件：它不是"普通下拉"（可能是一整块自定义 UI），硬铺进底行会失控
  if (p.component) return undefined
  // 预设件形态（比例网格 / 按钮网格 / 滑块）不铺开：它们要整块版面
  if (resolvePresetKind(p) !== undefined) return undefined
  return p
}

/** 该预设件的默认列数（照参考站实测：比例 5 列，其余 3 列） */
export function presetColumns(kind: PresetKind): number {
  return kind === 'ratio' ? 5 : 3
}
