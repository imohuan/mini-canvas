/**
 * ToolRegistry —— 通用"工具"注册表（内核自带：ctx.tools / ctx.get('tools')）。
 *
 * 归属：@mini-canvas/kernel 自带能力。工具是"拿上下文调外部能力"的通用注册表
 * （文生图 / 文生文 / 任意可注册的外部能力），本身不含任何画布概念。
 * 画布把它当作"能出图的工具列表"来用，是消费方的事。
 *
 * 为什么需要这一层：
 * - 节点的 AI 能力（文生图、图生图、文生文…）本质上都是"拿画布上下文去调一个外部 API"。
 *   若每个节点各写一份调用逻辑，换模型/换服务商就要改所有节点。
 * - 所以把"一次外部能力调用"抽象成 **工具**：谁提供服务谁注册一个工具，节点只管"列出可用工具 →
 *   用户选一个 → 带上上下文 invoke"。节点不认识 HTTP、不认识模型 id、不认识密钥。
 * - 加一个新模型 = 装一个注册了新工具的插件，节点与内核零改动。
 *
 * 与"命令(command)"的区别（别混）：
 * - command 是**画布内部动作**（删除/撤销/建节点），同步、无进度、不产出到画布。
 * - tool 是**外部能力调用**，可异步、带进度、有产物（图片 URL / 文本），且通常需要输入上下文。
 *
 * 依赖方向：纯内核、零 DOM、零 Vue（可 headless 单测）。真正发 HTTP 的实现留在插件侧。
 */
import type { Disposable } from './types'

/** 工具可以吃/产的资源类型（与节点连接的 acceptsTypes 同词表） */
export type ToolResourceKind = 'image' | 'text' | 'video' | 'audio'

/** 一次调用随行的画布上下文资源（上游连进来的图/文） */
export interface ToolResource {
  /** 上游节点 id（稳定身份） */
  id: string
  kind: ToolResourceKind
  /** 供 @ 引用与 UI 显示的名字 */
  name?: string
  /** 图片来源（图片/视频类） */
  url?: string
  /** 文本内容（文本类） */
  value?: string
}

/** 工具参数下拉里的一项 */
export interface ToolParamOption {
  label: string
  value: string
}

/**
 * 预设提示词模板（工具作者提供，面板据此渲染"模板"下拉；选中即把 prompt 填进输入框）。
 *
 * 为什么归工具而不是面板写死：模板与"这个模型擅长什么"强相关（写实模型和线稿模型的模板
 * 不是一套），由提供该模型的工具插件声明最合适；面板只负责列出与填入，加模板不用改面板。
 */
export interface ToolTemplate {
  /** 模板 id（面板内唯一） */
  id: string
  /** 下拉显示名 */
  name: string
  /** 选中后填入输入框的提示词正文 */
  prompt: string
  /** 可选一句话说明（tooltip/副标题用） */
  description?: string
  /** 只对某些工具生效时列出工具名；缺省 = 该工具通用 */
  forTools?: string[]
}

/**
 * 声明式参数：UI 据此**自动**渲染控件（比例下拉、分辨率下拉、模板下拉…）。
 * 工具自己声明有什么参数，节点 UI 不需要认识"比例"这个业务概念——
 * 加一个新参数（比如"风格"）不用改任何节点代码。
 */
export interface ToolParamDef {
  key: string
  /** 参数名（面板上显示的标签） */
  label?: string
  /** 一句话说明（面板 tooltip / 辅助文字） */
  description?: string
  /**
   * 内置控件类型（不给 component 时按它渲染标准控件）：
   * - 'select'  下拉（配 options）
   * - 'string'  单行文本
   * - 'number'  数字（配 min/max/step 时用滑块/数字输入）
   * - 'boolean' 开关
   */
  type?: 'select' | 'string' | 'number' | 'boolean'
  /** type='select' 时的候选值 */
  options?: ToolParamOption[]
  default?: string | number | boolean
  /** type='number' 时的取值范围与步长（面板据此决定控件形态） */
  min?: number
  max?: number
  step?: number
  /** type='string' 时的输入提示 */
  placeholder?: string
  /**
   * **自定义渲染组件**（opaque 句柄，与节点 content 段同一语义：内核不解析、不 import Vue）。
   *
   * 给了它就用它渲染本参数，忽略 type —— 这是"内置控件不够用"时的逃生口：
   * 例如想让"思考程度"显示成一排可点的档位卡片、想让"风格"显示成带缩略图的画廊，
   * 工具作者自带一个组件即可，**面板与本内核都不用改**。
   *
   * 组件收到的约定 props（与内置控件一致，便于替换）：
   *   param: ToolParamDef（本定义，可读 label/options/…）
   *   modelValue: 当前值
   *   disabled?: boolean（生成中时禁用）
   *   emits: update:modelValue（值变化时抛出，面板据此写回 params）
   */
  component?: unknown
  /** 透传给 component 的附加静态 props（自定义组件需要额外入参时用） */
  componentProps?: Record<string, unknown>
  /**
   * 布局权重：同一行里占几份（默认 1）。面板按此把参数排成一行/多行，
   * 例如把"思考程度"这种短参数设成 1、"提示词增强"这种长参数设成 2。
   */
  span?: number
}

/** 一次工具调用的输入 */
export interface ToolInput {
  /** 用户在输入框里写的内容（文本提示词；富文本以纯文本形式给出） */
  prompt?: string
  /** 画布上下文资源（上游连进来的素材） */
  resources?: ToolResource[]
  /** 用户在 UI 上选的参数值（键 = ToolParamDef.key） */
  params?: Record<string, unknown>
  [k: string]: unknown
}

/** 一次工具调用的终态结果 */
export interface ToolResult {
  ok: boolean
  /** ok=false 时的原因（直接展示给用户） */
  error?: string
  /** 产物地址（图片等） */
  urls?: string[]
  /** 文本产物（文生文类工具用） */
  text?: string
  /** 外部任务 id（可查询/取消） */
  taskId?: string
}

/** 运行中进度（UI 只依赖它渲染进度条与阶段文案） */
export interface ToolProgress {
  /** 0–100；外部只给阶段时可省略，UI 回落为进行中动画 */
  progress?: number
  message?: string
  taskId?: string
}

/** 轮询函数每次返回的状态 */
export type ToolPollState =
  | ({ status: 'running' } & ToolProgress)
  | { status: 'done'; result: ToolResult }

/** 异步工具返回的轮询函数：返回 'running' 则框架稍后再调，'done' 即终止 */
export type ToolPollFn = () => ToolPollState | Promise<ToolPollState>

/**
 * 工具 run 的返回契约：
 * - 直接返回（或解析到）ToolResult → 同步完成；
 * - 返回 ToolPollFn → 异步任务，由 ToolRegistry.invoke 负责轮询到 done（并转发进度）。
 *
 * 这两种形态足以覆盖"同步 HTTP 一次返回"和"提交任务后轮询"两类第三方 API。
 */
export type ToolOutcome = ToolResult | ToolPollFn

/**
 * 调用时注入的运行上下文（**调用方自定义**，工具实现按需读取，不需要就忽略）。
 *
 * 内核只透传不解释：调用方 invoke 时传什么，工具 run 就收到什么。
 * 画布场景会放 nodeId/canvasId（把结果写回节点、后台按画布归属），别的宿主放自己的键。
 */
export interface ToolRunContext {
  /** 发起调用的节点 id（画布场景约定键；别的宿主可以是别的含义或省略） */
  nodeId?: string
  /** 画布 id（画布场景约定键；同上） */
  canvasId?: string
  [k: string]: unknown
}

/** 一个工具的完整声明（注册进注册表的形状） */
export interface ToolDef {
  /** 唯一名（如 'image.generate:apimart-gpt-image-2'）；重复注册抛错 */
  name: string
  /** UI 显示名（模型下拉里显示的就是它） */
  title?: string
  /** 一句话说明（可用于 tooltip/说明） */
  description?: string
  /** 分组（UI 可据此归类；如 '图片生成' / '文本生成'） */
  group?: string
  /** 这个工具产出什么（节点据此挑"能给我出图的工具"） */
  produces?: ToolResourceKind
  /** 这个工具接受哪些输入资源（节点据此判断"当前连的素材能不能喂给它"；缺省=不挑） */
  accepts?: ToolResourceKind[]
  /** 声明式参数（UI 自动渲染下拉/开关） */
  params?: ToolParamDef[]
  /** 预设提示词模板（面板渲染"模板"下拉；加模板不用改面板） */
  templates?: ToolTemplate[]
  /** 执行体 */
  run(input: ToolInput, ctx: ToolRunContext): ToolOutcome | Promise<ToolOutcome>
}

/** invoke 的可选项 */
export interface ToolInvokeOptions {
  /** 运行上下文（节点 id / 画布 id 等） */
  ctx?: ToolRunContext
  /** 每个 running 进度回调一次（UI 刷新进度条） */
  onProgress?: (p: ToolProgress) => void
  /** 轮询间隔（ms，默认 650：与 v1 图片生成一致，进度看起来是连续的） */
  interval?: number
  /** 超时（ms，默认 5 分钟；超时按失败返回，不留悬挂任务） */
  timeoutMs?: number
}

/** 列表筛选条件（键都可选；给的键之间是"与"关系） */
export interface ToolFilter {
  group?: string
  produces?: ToolResourceKind
  /** 只要**能吃下**该输入类型的工具 */
  accepts?: ToolResourceKind
}

/** ctx.get('tools') 得到的服务形状 */
export interface ToolService {
  /** 注册一个工具；返回撤销句柄。同名重复注册抛错（防静默覆盖） */
  register(def: ToolDef): Disposable
  /** 按名注销（不存在返回 false） */
  unregister(name: string): boolean
  has(name: string): boolean
  get(name: string): ToolDef | undefined
  /** 枚举工具（可按分组/产出/可接受输入筛选） */
  list(filter?: ToolFilter): ToolDef[]
  /**
   * 调用一个工具并**归一化异步形态**：run 返回轮询函数时，本方法负责按 interval 驱动到 done，
   * 期间把 running 进度经 onProgress 转发出去；超时/异常都收敛成 { ok:false, error }。
   *
   * 调用方（节点 UI）因此只需处理一种返回形态，不必各自实现轮询与超时。
   */
  invoke(name: string, input: ToolInput, options?: ToolInvokeOptions): Promise<ToolResult>
}

/** 默认轮询间隔（ms） */
export const DEFAULT_TOOL_INTERVAL = 650
/** 默认超时（ms）：5 分钟，够一次真实出图，又不会让 UI 无限转圈 */
export const DEFAULT_TOOL_TIMEOUT = 300_000

/** 把任意异常收敛成"失败结果"（不往外抛，调用方路径统一） */
function toError(err: unknown, fallback: string): ToolResult {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return { ok: false, error: msg || fallback }
}

/** 判断 run 的返回值是不是轮询函数（ToolResult 是对象，PollFn 是函数——按此区分即可） */
function isPollFn(outcome: ToolOutcome): outcome is ToolPollFn {
  return typeof outcome === 'function'
}

export class ToolRegistry implements ToolService {
  private tools = new Map<string, ToolDef>()

  register(def: ToolDef): Disposable {
    if (!def?.name) throw new Error('[tools] 工具必须有 name')
    if (this.tools.has(def.name)) {
      throw new Error(`[tools] tool "${def.name}" already registered`)
    }
    this.tools.set(def.name, def)
    return {
      dispose: () => {
        // 只在仍是自己时删（重装场景下别人已顶替同名工具时不动它）
        if (this.tools.get(def.name) === def) this.tools.delete(def.name)
      },
    }
  }

  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name)
  }

  list(filter?: ToolFilter): ToolDef[] {
    const all = [...this.tools.values()]
    if (!filter) return all
    return all.filter((t) => {
      if (filter.group !== undefined && t.group !== filter.group) return false
      if (filter.produces !== undefined && t.produces !== filter.produces) return false
      if (filter.accepts !== undefined) {
        // 未声明 accepts = 不挑食，任何输入都收（与节点连接约束同一套"缺省即全收"语义）
        if (t.accepts && t.accepts.length > 0 && !t.accepts.includes(filter.accepts)) return false
      }
      return true
    })
  }

  async invoke(name: string, input: ToolInput, options: ToolInvokeOptions = {}): Promise<ToolResult> {
    const def = this.tools.get(name)
    if (!def) return { ok: false, error: `未找到工具 "${name}"` }

    const { interval = DEFAULT_TOOL_INTERVAL, timeoutMs = DEFAULT_TOOL_TIMEOUT, onProgress, ctx = {} } = options
    const startedAt = Date.now()

    let outcome: ToolOutcome
    try {
      outcome = await def.run(input, ctx)
    } catch (err) {
      return toError(err, '工具调用失败')
    }

    // 同步完成
    if (!isPollFn(outcome)) return outcome

    // 异步：驱动轮询到 done（超时收敛成失败，避免 UI 一直转圈）
    const poll = outcome
    while (true) {
      let state: ToolPollState
      try {
        state = await poll()
      } catch (err) {
        return toError(err, '工具执行中断')
      }
      if (state.status === 'done') return state.result
      onProgress?.({ progress: state.progress, message: state.message, taskId: state.taskId })
      if (Date.now() - startedAt > timeoutMs) {
        return { ok: false, error: '任务超时（未在预期时间内完成）', taskId: state.taskId }
      }
      await new Promise((r) => setTimeout(r, interval))
    }
  }
}

/**
 * 纯函数：把工具声明的参数 schema 收敛成"当前生效的参数值"。
 * UI 一进面板就用它给出默认值，避免各处自己写 `?? first option` 造成口径不一。
 */
export function resolveToolParams(def: ToolDef | undefined, current?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const p of def?.params ?? []) {
    const given = current?.[p.key]
    if (given !== undefined && given !== '') {
      out[p.key] = given
      continue
    }
    if (p.default !== undefined) {
      out[p.key] = p.default
      continue
    }
    // 没有默认值时：下拉取第一项（"不选中任何一项"对多数 API 是非法输入）
    if (p.type === 'select' && p.options?.length) out[p.key] = p.options[0].value
  }
  return out
}

/**
 * 纯函数：取某工具可用的提示词模板。
 *
 * 语义：工具自己的 templates 优先；另外收集"同产出类型"的其它工具里
 * `forTools` 命中该工具名的模板（允许把公共模板集中放在一个工具上供同一类模型共用）。
 * 按 id 去重（先到先得），避免同一个模板在下拉里出现两次。
 */
export function resolveToolTemplates(
  def: ToolDef | undefined,
  all: readonly ToolDef[] = [],
): ToolTemplate[] {
  if (!def) return []
  const out: ToolTemplate[] = []
  const seen = new Set<string>()
  const push = (t: ToolTemplate): void => {
    if (!t?.id || seen.has(t.id)) return
    seen.add(t.id)
    out.push(t)
  }
  for (const t of def.templates ?? []) push(t)
  for (const other of all) {
    for (const t of other.templates ?? []) {
      if (t.forTools && t.forTools.includes(def.name)) push(t)
    }
  }
  return out
}
