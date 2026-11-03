/** Context 生命周期状态 */
export type ContextState = 'created' | 'started' | 'stopped'

/** 单个插件的运行时态快照（P5：宿主/管理器/console 做 fiber 状态可查与 PENDING 诊断的只读视图） */
export interface PluginRuntimeStatus {
  /** 插件唯一名 */
  name: string
  /** fiber 状态名（pending/loading/active/failed/unloading/disposed，字符串便于展示/比较） */
  state: string
  /** 该插件 deps 中此刻仍未满足的依赖（仅当 state!=='active' 才可能非空；对齐 depSatisfied 判定） */
  missingDeps: string[]
  /** FAILED 时的错误信息（message 字符串，便于面板/console 展示）；非 FAILED 缺省 */
  error?: string
  /**
   * 是否核心插件（决策 1：拒绝动态热卸）。宿主 UI 据此**禁用卸载按钮**，
   * 而不是等用户点了才被拒（可诊断 > 事后报错）。非核心插件不带本字段。
   */
  core?: boolean
}
