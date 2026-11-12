/**
 * barContract —— 节点底栏的**纯结构契约**（零 Vue / 零具体插件）。
 *
 * 放在 canvas-data 的原因：服务名 → 类型的唯一事实源必须能被任何只依赖 canvas-base 的插件看到。
 * canvas-base 依赖 canvas-data，而 plugin-bottom-bar 是它的下游；契约留在上游，
 * 节点插件（文字 / 视频）就能 `ctx.get('nodeBar').register(...)` 而**不用 import 另一个插件**。
 *
 * 运行时实现在 plugin-bottom-bar：它构造 NodeBarService 并以 `nodeBar` 名字上架服务。
 * 注册条目落在**调用方传入的 scope**，所以卸载调用方插件时它注册的动作一起消失。
 *
 * 与内核工具词表复用同一套字段（ToolParamDef / ToolTemplate / ToolResult …）：
 * 底栏动作与 `ctx.tools` 里的生成工具本来就是同一件事。
 */
import type {
  PluginScope,
  ToolDef,
  ToolOutcome,
  ToolParamDef,
  ToolPollFn,
  ToolProgress,
  ToolPromptSegment,
  ToolResource,
  ToolResourceKind,
  ToolResult,
  ToolTemplate,
} from '@plume-canvas/kernel'

/** 一次动作调用的输入（底栏只组装这三样） */
export interface BarRunInput {
  /** 用户在输入框写的内容：标签与文字分开，顺序即输入顺序（needsPrompt 动作才有） */
  prompts?: ToolPromptSegment[]
  /** 用户在可视化控件里选的值（键 = ToolParamDef.key） */
  values?: Record<string, unknown>
  /** 上游连进来的素材（与内核 ToolResource 同形） */
  resources?: ToolResource[]
}

/** 运行一个动作时注入的上下文 */
export interface BarRunContext {
  nodeId: string
  nodeType: string
  canvasId?: string
  signal: AbortSignal
  onProgress(p: ToolProgress): void
  /** 读本节点 data（动作要看现有内容时用） */
  readData(): Record<string, unknown>
}

/** 底栏动作：一个「能被用户点、点了有结果」的东西 */
export interface BarAction {
  id: string
  /** 给哪些节点类型用；省略 = 所有类型都适用 */
  types?: string[]
  title: string
  description?: string
  /** 图标（opaque 句柄：SVG 字符串，或 data:image/…;base64,…） */
  icon?: string
  group?: string
  fields?: ToolParamDef[]
  templates?: ToolTemplate[]
  /** provider 自带的 HTML 配置面板（宿主在沙箱 iframe 里渲染） */
  panelHtml?: string
  needsPrompt?: boolean
  promptBinding?: 'none' | 'text'
  panel?: unknown
  apply?: 'applier' | 'self'
  externalRunState?: boolean
  order?: number
  onSelect?(nodeId: string): void
  onDeselect?(nodeId: string): void
  pollIntervalMs?: number
  pollTimeoutMs?: number
  run(input: BarRunInput, runCtx: BarRunContext): ToolOutcome | Promise<ToolOutcome>
  resume?(taskId: string, runCtx: BarRunContext): ToolPollFn | undefined
  onCancel?(taskId: string, runCtx: BarRunContext): void | Promise<void>
  cancellable?: boolean
}

/** 结果写入器：把动作产物写进节点（走 doc.updateNode，是作品、进历史） */
export type BarApplier = (
  nodeId: string,
  result: ToolResult,
  runCtx: { nodeType: string },
) => void | Promise<void>

/** `publishTools` 的选项：把 ctx.tools 里某类工具自动映射成底栏动作 */
export interface PublishToolActionsOptions {
  types: string[]
  produces: ToolResourceKind
  needsPrompt?: boolean
  promptBinding?: 'none' | 'text'
  apply?: 'applier' | 'self'
  kindOf?: (nodeType: string) => ToolResourceKind
}

/**
 * 底栏服务的对外契约（服务名 `nodeBar`）。
 *
 * 读口：list / get / applierOf / state。
 * 写口都收**调用方自己的 scope**，这样条目归调用方、卸载自动摘除。
 */
export interface NodeBarContract {
  list(filter?: { type?: string }): BarAction[]
  get(id: string): BarAction | undefined
  applierOf(kind: string): BarApplier | undefined
  state(nodeId: string): unknown
  register(scope: PluginScope, action: BarAction): void
  registerApplier(scope: PluginScope, kind: string, fn: BarApplier): void
  publishTools(scope: PluginScope, opts: PublishToolActionsOptions): () => void
}

/** 内核工具 → 底栏动作的单条转换（纯函数；供 plugin-bottom-bar 内部复用） */
export function barToolToAction(
  tool: ToolDef,
  opts: PublishToolActionsOptions,
  invoke: (input: BarRunInput, runCtx: BarRunContext) => Promise<unknown>,
): BarAction {
  return {
    id: 'tool:' + tool.name,
    types: [...opts.types],
    title: tool.title ?? tool.name,
    description: tool.description,
    group: tool.group,
    fields: tool.params ? tool.params.map((p) => ({ ...p })) : undefined,
    templates: tool.templates ? tool.templates.map((t) => ({ ...t })) : undefined,
    needsPrompt: opts.needsPrompt,
    promptBinding: opts.promptBinding,
    apply: opts.apply,
    async run(input: BarRunInput, runCtx: BarRunContext) {
      return (await invoke(input, runCtx)) as ToolOutcome
    },
  }
}
