/**
 * provider（平台提供方）契约 —— 「后台也能像前端那样丢文件扩展」的接口。
 *
 * 前端加能力 = 丢一个插件进目录；后台过去只能改源码。这一层把后台也开成目录扫描：
 * 每个 `.js` 就是一个 provider，声明它提供哪些动作、怎么提交任务、怎么查进度、怎么取消。
 *
 * 内置的 web2api 也**用同一套接口**写成第一个 provider —— 内置与外挂走同一条路，
 * 不存在「内置一套、外挂另一套」。照抄内置那个就知道自己该怎么写。
 *
 * 与前端的关系：后端拿所有 provider 的 `actions` 并集喂给前端当菜单。
 * 所以后台加一个平台，前端的模型下拉里自动多一项，前端一行不用改。
 */

/** 动作参数的一种取值（下拉用） */
export interface ParamOption {
  label: string
  value: string
}

/**
 * 动作参数声明。
 *
 * `kind` 是**语义类型**（比例 / 时长 / 音色…），前端据此挑对应的控件；
 * `type` 只是兜底的控件类型（服务端 schema 表达不出"哪个是比例"这种知识）。
 */
export interface ActionParam {
  key: string
  /** 语义类型：ratio / duration / resolution / speaker / camera / count / speed / format… */
  kind?: string
  label?: string
  type: 'select' | 'number' | 'boolean' | 'text'
  default?: string | number | boolean
  options?: ParamOption[]
  min?: number
  max?: number
  step?: number
  unit?: string
}

/** 节点类型（动作服务哪几种节点） */
export type ProviderNodeType = 'image' | 'video' | 'audio'

/**
 * 一个动作的声明。
 *
 * 前半段是**给前端渲染**的（菜单长什么样）；后半段是**给后台执行**的
 * （用哪个工具、怎么拼参数），前端拿到也不认识、会忽略。
 */
export interface ActionDef {
  /** 动作 id（全局唯一；同名 = 替换） */
  id: string
  /** 按钮 / 下拉里显示的名字（通常就是模型名） */
  title: string
  description?: string
  group?: string
  /** 排序（小的在前） */
  order?: number
  /** 服务哪些节点类型；省略 = 都适用 */
  nodeTypes?: ProviderNodeType[]
  /** 要不要底栏那个大输入框 */
  needsPrompt?: boolean
  /** 输入框和节点哪个字段绑（'text' = 文本节点） */
  promptBinding?: 'none' | 'text'
  /** 可视化参数（前端据此长控件） */
  fields?: ActionParam[]

  // ==================== 以下字段只有后台认识，前端会忽略 ====================
  /** 该动作交给 provider 的哪个工具（provider 自己解释，内核不管） */
  tool?: string
  /** 平台侧的模型名（如 seedance_v2.0_mini） */
  model?: string
  /** 参数怎么传：chat-auto = 拼进提示词前缀；plain = 当工具参数直传 */
  promptMode?: 'chat-auto' | 'plain'
  /** chat-auto 时的媒体模式 */
  mediaMode?: 'image' | 'video'
  /** 本动作自己的轮询节奏（长视频不能被共享的短超时误杀） */
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /** provider 可以塞自己的东西；内核与前端都不读 */
  [k: string]: unknown
}

/** 一次任务提交的入参（前端下单时给的） */
export interface JobInput {
  canvasId: string
  /** 结果写回的目标节点 */
  nodeId: string
  actionId: string
  /** 用户在输入框写的提示词 */
  prompt?: string
  /** 用户在可视化控件里选的值（键 = ActionParam.key） */
  values?: Record<string, unknown>
  /**
   * 上游连进来的素材（图片 / 视频 / 文本）。
   *
   * `url` 是**画布内引用**（res:<hash>）或绝对地址；provider 若需要真实字节/真实地址，
   * 由宿主在提交前解析好（见 tasks/ 的说明）。
   */
  resources?: Array<{ kind: string; url?: string; value?: string }>
}

/** 提交结果：要么给了 taskId（异步，要轮询），要么直接完成，要么直接失败 */
export type ProviderSubmitResult =
  | { taskId: string; urls?: string[]; text?: string }
  | { done: true; urls?: string[]; text?: string }
  | { error: string }

/** 轮询一拍的返回 */
export interface ProviderPollResult {
  status: 'running' | 'done' | 'error'
  progress?: number
  message?: string
  /** provider 自己的任务号（后台记着，取消时要用） */
  taskId?: string
  /** status=done 时的产物 */
  urls?: string[]
  text?: string
  /** status=error 时的原因 */
  error?: string
}

/**
 * 平台提供方。
 *
 * 一个文件、纯 JS、**不需要引任何东西** —— 丢进 providers 目录、重启即生效。
 * 三个方法都可选（只做同步生成的话，`submit` 直接返回 `{done:true}` 即可）。
 */
export interface Provider {
  /** provider id（唯一；用来把任务路由回它） */
  id: string
  /** 它提供哪些动作 */
  actions: ActionDef[]
  /** 提交一个任务 */
  submit(action: ActionDef, input: JobInput): Promise<ProviderSubmitResult>
  /** 查一次进度（submit 给了 taskId 才需要） */
  poll?(taskId: string, action: ActionDef): Promise<ProviderPollResult>
  /** 取消一个服务端任务（尽力而为） */
  cancel?(taskId: string, action: ActionDef): Promise<void>
}

/** 校验一个来源不明的模块是不是合法 provider（目录里可能是手写的、写错的 js） */
export function isValidProvider(v: unknown): v is Provider {
  if (!v || typeof v !== 'object') return false
  const p = v as Partial<Provider>
  if (typeof p.id !== 'string' || p.id === '') return false
  if (!Array.isArray(p.actions)) return false
  if (typeof p.submit !== 'function') return false
  return p.actions.every((a) => a && typeof a === 'object' && typeof (a as ActionDef).id === 'string')
}
