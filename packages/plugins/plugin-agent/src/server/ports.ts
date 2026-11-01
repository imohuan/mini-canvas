/**
 * Agent 后台的**中立端口**（宿主能力注入面）。
 *
 * 为什么需要这一层：Agent 后台是插件自己的代码，但它要用到几项**只属于宿主**的能力 ——
 * 数据目录在哪、画布目录怎么拼、小数据 KV 怎么读写、插件注册场里的提示词小节 / 中间件。
 * 直接 import cloud-server 的内部模块，等于让插件反向依赖宿主（还会被 data: URL 的单文件
 * 加载器拒绝）。所以这些能力一律**由宿主注入**，插件只认这里的接口。
 *
 * 约定：
 * - 端口只描述「要什么」，不描述「谁实现」；
 * - 任何一项都不允许插件自己 new 一份宿主实现；
 * - 端口缺失时宁可报错，也不要悄悄退化（退化出来的行为最难查）。
 */

/** 一项 KV 小数据（与宿主 /api/kv 的 (type,key) 两级同形）。 */
export interface AgentKvPort {
  get<T = unknown>(type: string, key: string): Promise<T | undefined>
  set(type: string, key: string, value: unknown): Promise<void>
}

/** Agent 系统提示词小节的「读形态」（宿主注册场里的条目视图）。 */
export interface AgentPromptSectionView {
  id: string
  title: string
  source: string
  order: number
  text: string
}

/** 一次 Agent 轮次的可变入参（形状对齐 runtime.StartRunInput 的公开面）。 */
export interface AgentTurnEnvelope {
  canvasId: string
  input: {
    canvasId: string
    sessionId?: string
    text: string
    images?: string[]
    prefs?: unknown
  }
  abortSignal?: AbortSignal
}

/** 中间件链的返回：blocked 为真表示不再往下走（不进模型）。 */
export interface AgentTurnOutcome {
  blocked?: true
  response?: unknown
}

/** 宿主提供给 Agent 后台的全部能力。 */
export interface AgentHostPorts {
  /** 数据根（与 cloud-server 的 dataDir 同一个） */
  dataDir: string
  /** 画布目录（宿主负责 id 校验；插件不自己拼路径） */
  canvasDirOf: (canvasId: string) => string
  /** 宿主 KV（与 /api/kv 同一份 settings.json） */
  kv: AgentKvPort
  /** 插件注册场里的提示词小节（每次建会话现读，不能快照） */
  promptSections: () => AgentPromptSectionView[]
  /** 跑一遍插件的 pre-turn 中间件链 */
  runMiddleware: (turn: AgentTurnEnvelope) => Promise<AgentTurnOutcome>
  /** 一键导入技能的候选目录（缺省用宿主默认） */
  skillSources?: string[]
  /** vendor 资产目录（goal hook 的仓库内来源）；不给就回落到 SDK 那份 */
  vendorPluginsDir?: string
  /** 诊断日志 */
  log?: (message: string, extra?: unknown) => void
}
