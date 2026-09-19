/**
 * surface —— 自省 API：一次列出「这台画布上注册了什么、各自支持什么」。
 *
 * 为什么需要它：装载（plugin）、服务（provide/get）、注册场（registryOf）三根轴各自都有
 * 「往里放」的 API，但「往里放了哪些、我能调哪些、参数长什么样」此前要翻源码才知道。
 * `ctx.surface()` 把三根轴一次性读出来，供诊断面板 / 文档生成 / AI 探查使用。
 * 只读、零副作用：不注册任何东西、不触发事件，随时可调（created/started 皆可）。
 *
 * 类型策略：能复用既有导出类型就复用（ToolParamDef / ToolParamOption / ContextState），
 * 不把字面量联合退化成 string —— 那会让自省结果失去编译期价值（严格审查 B2）。
 */
import type { ContextState } from './Context'
import type { ToolParamDef } from './toolRegistry'

/** 自省报告里的参数形状 = ToolParamDef 去掉不透明句柄后的可读投影 */
export type ToolParamSurface = Omit<ToolParamDef, 'component' | 'componentProps'> & {
  /** 该参数是否自带自定义渲染组件（句柄本身 opaque，不外泄） */
  hasCustomComponent?: boolean
}
/** 服务条目：一个按名可取的能手 */
export interface ServiceSurface {
  name: string
  /** 注册方：插件名 / '<host>' / '<anonymous>' / '<builtin>'（内核或能力层内置） */
  source: string
  /**
   * 该服务暴露的方法名（**best-effort 诊断信息**，不是稳定契约）。
   * descriptor 反射取：只读 value 为函数的自有属性 + 原型链，**不执行 getter**。
   * 压缩/混淆后可能失真；Vue 代理实例可能只暴露自有属性。缺省 = 拿不到。
   */
  methods?: string[]
}

/** 注册场条目：某 kind 场里的一条 */
export interface RegistryEntrySurface {
  kind: string
  /** 场内键（如 'image/out:top'） */
  key: string
  id: string
  order: number
  source: string
  /**
   * 该条目值的**顶层字段名**（best-effort 诊断信息，不是稳定契约）。
   * 值不是普通对象（函数 / 组件句柄 / 原始值）时为 undefined。
   *
   * 为什么给字段名而不是值：作者最常问的是"别人注册那条**有什么可读的**"
   * （比如 node/region 条目的 needs/props），把值整个摊出去既读不完也会泄漏句柄。
   */
  fields?: string[]
}

/** 注册场汇总：一个 kind + 它下面全部键 */
export interface RegistryKindSurface {
  kind: string
  /** 该 kind 下每个键及其条目数（升序；不用两个平行数组靠下标对齐 —— 审查 B5） */
  keys: Array<{ key: string; count: number }>
}

/** 命令条目（CommandDef 的自省形状） */
export interface CommandSurface {
  id: string
  title?: string
  keys?: string[]
  areas?: string[]
  group?: string
  order?: number
  /** 图标（字符串标识或 svg 路径；UI 按它渲染） */
  icon?: string
  source: string
  /**
   * 这条命令从哪读到的：
   * - 'field'：注册场（`ctx.commands.register` 糖的落点，含插件注册的命令）；
   * - 'service'：command 服务直注册（数据层自带的建节点/删除/撤销/重做走这条）。
   * 两处都要读才完整 —— 只读场会漏掉核心命令。
   */
  origin: 'field' | 'service'
}

/** 生成工具（ctx.tools）条目 */
export interface ToolSurface {
  name: string
  title?: string
  description?: string
  group?: string
  produces?: string
  accepts?: string[]
  /** 声明式参数（UI 自动渲染下拉/开关用）；形状直接复用 ToolParamDef，不手抄字段 */
  params?: ToolParamSurface[]
  /** 预设提示词模板（含正文与适用范围） */
  templates?: Array<{ id: string; name: string; prompt: string; description?: string; forTools?: string[] }>
}

/** 模型可调用工具（registryOf('tool')）条目 */
export interface ModelToolSurface {
  name: string
  description: string
  parameters: unknown
  /** 产物 schema；工具未声明 output 时为 undefined（不用 {} 冒充 —— 审查 B2） */
  outputSchema?: unknown
  source: string
}

/** 一次 surface() 的完整快照 */
export interface SurfaceReport {
  state: ContextState
  services: ServiceSurface[]
  registries: RegistryKindSurface[]
  registryEntries: RegistryEntrySurface[]
  commands: CommandSurface[]
  tools: ToolSurface[]
  modelTools: ModelToolSurface[]
  /**
   * 已登记的事件名（`registerEventName` 的登记表）。
   *
   * 为什么要这条轴：作者想问"这台画布上都有哪些事件可监听"，此前只能翻源码；
   * 而 dev 下"未登记的事件名"会 warn，登记表因此正好是"有哪些事件"的权威清单。
   */
  events: string[]
}
