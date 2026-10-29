/**
 * 主题插件类型定义
 *
 * 主题系统通过 CSS 自定义属性（--canvas-node-*）控制节点视觉样式。
 * 支持两种设置方式：
 * 1. applyPreset(name) — 一键应用预设主题（如 slate / blue / green）
 * 2. patchVariables(vars) — 单独覆盖任意 CSS 变量
 */

/** 主题预设名称 */
export type ThemePresetName = 'slate' | 'blue' | 'green' | 'warm' | 'custom'

/**
 * 主题预设定义
 *
 * 每个预设包含一个基准 accent 色（用于计算环、阴影等半透明颜色）
 * 以及一组可选的变量覆盖。
 */
export interface ThemePreset {
  /** 预设名称 */
  name: ThemePresetName
  /** 显示标签 */
  label: string
  /** 基准强调色（HEX 格式，如 #111827），用于计算所有 opacity 相关颜色 */
  accent: string
  /** 基准表面色（HEX 格式，如 #f9fafb），用于计算 surface/hover/active 层次 */
  surface: string
  /** 文本强色（HEX，如 #111827） */
  textStrong: string
  /** 文本常规色（HEX，如 #4b5563） */
  text: string
  /** 文本弱色（HEX，如 #64748b） */
  textMuted: string
  /** 可选：覆盖任意 CSS 变量（优先级高于自动计算） */
  override?: Record<string, string>
}

/**
 * 主题状态（存储在 store.plugins.theme 中）
 *
 * 响应式结构，所有字段通过 context.store.get/set 操作。
 * 组件通过 useCanvasStore().state.plugins.theme 直接读取。
 */
export interface ThemeState {
  /** 当前激活的预设名称 */
  activePreset: ThemePresetName
  /** 当前使用的 accent 色（HEX） */
  accent: string
  /** 当前使用的 surface 色（HEX） */
  surface: string
  /** 当前文本强色 */
  textStrong: string
  /** 当前文本常规色 */
  text: string
  /** 当前文本弱色 */
  textMuted: string
  /** 用户手动覆盖的变量映射（key = CSS var name without leading --） */
  customVariables: Record<string, string>
}

/**
 * 完整的 CSS 变量名列表
 *
 * 对应 node-theme.css 中 :root 块内的所有 --canvas-node-* 变量。
 */
export const THEME_CSS_VARS = [
  'canvas-node-surface',
  'canvas-node-panel-surface',
  'canvas-node-panel-surface-hover',
  'canvas-node-panel-surface-active',
  'canvas-node-text-muted',
  'canvas-node-text',
  'canvas-node-text-strong',
  'canvas-node-border',
  'canvas-node-border-subtle',
  'canvas-node-border-hover',
  'canvas-node-border-selected',
  'canvas-node-ring',
  'canvas-node-ring-soft',
  'canvas-node-ring-transparent',
  'canvas-node-shadow-strong',
  'canvas-node-shadow-soft',
  'canvas-node-shadow-subtle',
  'canvas-node-shadow-panel',
  'canvas-node-resize-handle',
  'canvas-node-resize-handle-active',
  'canvas-node-target-zone-surface',
  'canvas-node-target-zone-border',
  'canvas-node-snap-zone-surface',
  'canvas-node-snap-zone-border',
  'canvas-node-snap-zone-highlight',
  'canvas-node-snap-zone-shadow',
  'canvas-node-debug-danger',
  'canvas-node-debug-danger-fill',
  'canvas-node-debug-center',
  'canvas-node-debug-rest',
  'canvas-node-debug-mouse',
  'canvas-node-debug-label-stroke',
] as const

export type ThemeCssVar = (typeof THEME_CSS_VARS)[number]

/** 主题插件配置选项（接口传参） */
export interface ThemeOptions {
  /** 初始预设 */
  preset?: ThemePresetName
  /** 自定义 accent 色（仅 preset='custom' 时生效） */
  accent?: string
  /** 自定义 surface 色 */
  surface?: string
  /** 手动覆盖的颜色映射 */
  overrides?: Record<string, string>
  [key: string]: unknown
}

/** 主题插件暴露的 API */
export interface ThemeAPI {
  /** 当前主题状态（响应式） */
  readonly state: ThemeState

  /** 一键应用预设主题 */
  applyPreset(name: ThemePresetName): void

  /** 从自定义 accent + surface 颜色计算并应用完整主题 */
  applyCustom(accent: string, surface?: string): void

  /** 覆盖单个 CSS 变量（传 null 或 undefined 清除覆盖，恢复自动计算值） */
  setVariable(name: ThemeCssVar, value: string | null): void

  /** 批量覆盖变量 */
  setVariables(vars: Partial<Record<ThemeCssVar, string | null>>): void

  /** 重置为默认 slate 主题 */
  reset(): void

  /** 获取所有可用的预设列表 */
  getPresets(): ThemePreset[]
}
