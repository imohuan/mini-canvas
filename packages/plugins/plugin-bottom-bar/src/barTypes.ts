/**
 * barTypes —— 底栏动作的类型层（纯类型，零运行时代码）。
 *
 * 为什么复用内核工具的词表（ToolParamDef / ToolTemplate / ToolProgress / ToolResult / ToolOutcome）而不新造：
 * 底栏动作与 ctx.tools 里的生成工具本来就是同一件事 ——「拿上下文调一个能力、拿回产物」。
 * 两套词表会漂移（今天两份底栏就是前车之鉴）；一个词表两处用，底栏与工具面板
 * 长得一样是因为它们本来就是同一件事。
 *
 * 归属规则（最容易写错的一条）：动作落场用注册方自己的 ctx（registerBarAction 糖），
 * 不要存到 NodeBarService 上 —— 共享单实例的 this.ctx 恒为 bottom-bar 的 scope，
 * 条目会挂在 bottom-bar 名下，别人插件卸载就摘不掉自己的动作。
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

/** 运行一个动作时注入的上下文（与内核 ToolRunContext 同型家，多了取消与进度回调） */
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

/** 底栏动作：一个「能被用户点、点了有结果」的东西（模型 / 加工 / 工具，同一套形状） */
export interface BarAction {
  /** 唯一 id（用户说的「标识」）：同 id 重复注册 = 替换（热更） */
  id: string
  /** 给哪些节点类型用；省略 = 所有类型都适用 */
  types?: string[]
  /** 按钮 / 下拉里显示的名字 */
  title: string
  /** 一句话说明（tooltip） */
  description?: string
  /** 图标（opaque 句柄：SVG 字符串，与节点类型 icon 同一写法） */
  icon?: string
  /** 分组（底栏据此归类） */
  group?: string
  /** 可视化配置：复用内核 ToolParamDef 词表，底栏据此自动长控件 */
  fields?: ToolParamDef[]
  /** 预设模板（复用内核 ToolTemplate，选中即填进输入框） */
  templates?: ToolTemplate[]
  /** 要不要底栏那个大输入框（默认 false） */
  needsPrompt?: boolean
  /**
   * 输入框和节点哪个字段绑在一起。
   * - 'none'（默认）：输入框是临时的，内容随 prompt 传给 run；
   * - 'text'：输入框 = data.text（文本节点用），编辑即写回节点、生成结果也写回它。
   */
  promptBinding?: 'none' | 'text'
  /** 选中本动作时渲染的专属面板（video 剪辑时间轴走这条） */
  panel?: unknown
  /**
   * 结果怎么落到节点：
   * - 'applier'（默认）：交给同 kind 的写入器；
   * - 'self'：本动作自己已经写好节点（旋转/下载/复制/删除这类即时动作），
   *   别让写入器再写一遍。
   */
  apply?: 'applier' | 'self'
  /** 排序（小者在先；没给的一律排最后） */
  order?: number
  /**
   * 本动作在节点上显示的只读读数（文本节点「12 字 · 3 行」这类）。
   * 只拿到 data —— 底栏不认识业务含义；返回空串 = 不显示。
   */
  info?(data: Record<string, unknown>): string
  /** 本动作被选中 / 取消选中（video 剪辑会话靠它开合） */
  onSelect?(nodeId: string): void
  onDeselect?(nodeId: string): void
  /** 执行体：与内核工具同一个契约（同步 ToolResult，或返回轮询函数） */
  run(input: BarRunInput, ctx: BarRunContext): ToolOutcome | Promise<ToolOutcome>
  /** 刷新后接着查（可选）：拿 taskId 造一个轮询函数 */
  resume?(taskId: string, ctx: BarRunContext): ToolPollFn | undefined
  /**
   * 取消一个**已经在服务端排队的任务**（可选）。
   *
   * 为什么单独一个钩子而不是复用 signal：`signal` 只能停掉**客户端**这边继续等，
   * 服务端那个任务还在排队/执行（next 用户会看到它继续跑、继续烧额度）。
   * 覆盖层的「取消」按钮在 abort 之后会调它，让插件有机会去服务端真正取消。
   * 收不到 taskId（还没提交出去）时不调用 —— 此时 abort 已经够了。
   */
  onCancel?(taskId: string, ctx: BarRunContext): void | Promise<void>
}

/** 结果写入器：把动作产物写进节点（走 doc.updateNode，是作品、进历史） */
export type BarApplier = (
  nodeId: string,
  result: ToolResult,
  ctx: { nodeType: string },
) => void | Promise<void>

/** 动作执行的只读查找口（taskRuntime 不关心注册方式，只要能查） */
export interface BarLookup {
  get(id: string): BarAction | undefined
  applierOf(kind: string): BarApplier | undefined
}

// 页脚：这些类型是本包对外契约的一部分；改任何一个都要过计划与审核，
// 因为它们同时是「别的插件怎么往底栏发布动作」的合同。
