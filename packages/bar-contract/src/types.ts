/**
 * 底栏动作的公共类型 —— 与 plugin-bottom-bar 的 barTypes 同形。
 *
 * 为什么复用内核工具的词表（ToolParamDef / ToolTemplate / ToolProgress / ToolResult /
 * ToolOutcome）：底栏动作与 ctx.tools 里的生成工具本来就是同一件事。
 * 契约包只放类型，实现（注册塞、执行器、组件）仍在 plugin-bottom-bar。
 */
import type {
  ToolParamDef,
  ToolPollFn,
  ToolProgress,
  ToolResource,
  ToolResult,
  ToolOutcome,
  ToolTemplate,
} from '@mini-canvas/kernel'

/** 一次动作调用的输入（与内核 ToolInput 同构的子集，底栏仅组装这三样） */
export interface BarRunInput {
  /** 用户在底栏输入框写的内容（needsPrompt 动作才有） */
  prompt?: string
  /** 用户在可视化配置控件里选的值（键 = ToolParamDef.key） */
  values?: Record<string, unknown>
  /** 上游连进来的素材（与内核 ToolResource 同形） */
  resources?: ToolResource[]
}

/** 运行一个动作时注入的上下文 */
export interface BarRunContext {
  /** 发起节点 */
  nodeId: string
  /** 节点类型（动作可能服务多类型） */
  nodeType: string
  /** 画布 id（存在时透传） */
  canvasId?: string
  /** 取消信号（覆盖层的「取消」按钮触发） */
  signal: AbortSignal
  /** 进度回调（runAction 据此写中间帧） */
  onProgress(p: ToolProgress): void
  /** 读本节点 data（动作要看现有内容时用，不必自己去 get 服务） */
  readData(): Record<string, unknown>
}

/** 底栏动作：一个「能被用户点、点了有结果」的东西 */
export interface BarAction {
  /** 唯一 id（同 id 重复注册 = 替换，热更） */
  id: string
  /** 给哪些节点类型用；省略 = 所有类型都适用 */
  types?: string[]
  /** 按钮 / 下拉里显示的名字 */
  title: string
  /** 一句话说明（tooltip） */
  description?: string
  /** 图标（opaque 句柄：SVG 字符串，或 data:image/…;base64,…） */
  icon?: string
  /** 分组（底栏据此归类） */
  group?: string
  /** 可视化配置：复用内核 ToolParamDef 词表 */
  fields?: ToolParamDef[]
  /** 预设模板（复用内核 ToolTemplate） */
  templates?: ToolTemplate[]
  /**
   * provider 自带的 HTML 配置面板（自包含一段 HTML：样式 + 可选脚本）。
   * 有它时优先用它替代默认的参数控件；没有就走 fields 的内置可视化。
   * 宿主在沙箱 iframe 里渲染，并通过 postMessage 把当前参数注入进去。
   */
  panelHtml?: string
  /** 要不要底栏那个大输入框（默认 false） */
  needsPrompt?: boolean
  /** 输入框和节点哪个字段绑在一起：'text' = data.text（文本节点） */
  promptBinding?: 'none' | 'text'
  /** 选中本动作时渲染的专属面板（视频剪辑时间轴走这条） */
  panel?: unknown
  /** 结果怎么落到节点：'applier'（默认）交给写入器；'self' 动作自己已写好 */
  apply?: 'applier' | 'self'
  /** 状态由外部（后台）写：底栏不再自己写 runState */
  externalRunState?: boolean
  /** 排序（小者在先；没给的一律排最后） */
  order?: number
  /** 本动作被选中 / 取消选中 */
  onSelect?(nodeId: string): void
  onDeselect?(nodeId: string): void
  /** 本动作自己声明的轮询节奏（缺省用底栏共享值） */
  pollIntervalMs?: number
  pollTimeoutMs?: number
  /** 执行体：与内核工具同一个契约（同步结果，或返回轮询函数） */
  run(input: BarRunInput, runCtx: BarRunContext): ToolOutcome | Promise<ToolOutcome>
  /** 刷新后接着查：拿 taskId 造一个轮询函数 */
  resume?(taskId: string, runCtx: BarRunContext): ToolPollFn | undefined
  /** 取消一个已经在服务端排队的任务 */
  onCancel?(taskId: string, runCtx: BarRunContext): void | Promise<void>
}

/** 结果写入器：把动作产物写进节点（走 doc.updateNode，是作品、进历史） */
export type BarApplier = (
  nodeId: string,
  result: ToolResult,
  runCtx: { nodeType: string },
) => void | Promise<void>
