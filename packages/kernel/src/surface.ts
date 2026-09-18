/**
 * surface —— 自省 API：一次列出「这台画布上注册了什么、各自支持什么」。
 *
 * 为什么需要它：装载（plugin）、服务（provide/get）、注册场（registryOf）三根轴各自都有
 * 「往里放」的 API，但「往里放了哪些、我能调哪些、参数长什么样」此前要翻源码才知道。
 * `ctx.surface()` 把三根轴一次性读出来，供诊断面板 / 文档生成 / AI 探查使用。
 * 只读、零副作用：不注册任何东西、不触发事件，随时可调（created/started 皆可）。
 */
/** 服务条目：一个按名可取的能手 */
export interface ServiceSurface {
  name: string
  /** 注册方：插件名 / '<host>' / '<anonymous>' */
  source: string
}

/** 注册场条目：某 kind 场里的一条 */
export interface RegistryEntrySurface {
  kind: string
  /** 场内键（如 'image/out:top'） */
  key: string
  id: string
  order: number
  source: string
}

/** 注册场汇总：一个 kind + 它下面全部键 */
export interface RegistryKindSurface {
  kind: string
  /** 该 kind 的键列表（升序） */
  keys: string[]
  /** 每键条目数（与 keys 平行） */
  entries: number[]
}

/** 命令条目（CommandDef 的自省形状） */
export interface CommandSurface {
  id: string
  title?: string
  keys?: string[]
  areas?: string[]
  group?: string
  order?: number
  source: string
}

/** 生成工具（ctx.tools）条目 */
export interface ToolSurface {
  name: string
  title?: string
  description?: string
  group?: string
  produces?: string
  accepts?: string[]
  params?: Array<{ key: string; label?: string; type?: string; required?: boolean; options?: Array<{ label: string; value: string | number | boolean }> }>
  templates?: Array<{ id: string; name: string }>
}

/** 模型可调用工具（registryOf('tool')）条目 */
export interface ModelToolSurface {
  name: string
  description: string
  parameters: unknown
  outputSchema: unknown
  source: string
}

/** 一次 surface() 的完整快照 */
export interface SurfaceReport {
  state: string
  services: ServiceSurface[]
  registries: RegistryKindSurface[]
  registryEntries: RegistryEntrySurface[]
  commands: CommandSurface[]
  tools: ToolSurface[]
  modelTools: ModelToolSurface[]
}
