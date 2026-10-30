/**
 * 预览页的「试玩」配置。
 *
 * 关键约定：每个组件都有自己的配置文件（本目录 <id>.ts），文件里声明：
 *   - 可调参数 state 与默认值
 *   - 右侧面板要显示哪些控件（fields）
 *   - 一键套用的预设（presets）
 *   - 参数摘要（summary）
 *
 * 页面本身不认识任何具体组件，只按 id 去 catalog 里取配置再渲染。
 * 加新组件 = 新增一个配置 + 在 catalog 里登记，不用改页面。
 */

import type { UiKitSize } from '../../shared/types'

export type PlaygroundValue = string | number | boolean | null

export interface SegmentOption {
  value: string
  label: string
}

/** 右侧面板的一种控件。 */
export type PlaygroundField =
  | { kind: 'text'; key: string; label: string; placeholder?: string; maxlength?: number }
  | { kind: 'number'; key: string; label: string; min?: number; max?: number; step?: number; suffix?: string }
  | { kind: 'segment'; key: string; label: string; options: SegmentOption[] }
  | { kind: 'toggle'; key: string; label: string }
  | { kind: 'range'; key: string; label: string; min: number; max: number; step: number; unit?: string }

export interface PlaygroundPreset {
  id: string
  name: string
  description: string
  patch: Record<string, PlaygroundValue>
}

/** 一个组件的完整试玩配置。 */
export interface ComponentPlayground {
  /** 与 catalog / docs 的 id 一致 */
  id: string
  /** 默认参数 */
  defaults: Record<string, PlaygroundValue>
  /** 右侧面板控件，按顺序渲染 */
  fields: PlaygroundField[]
  /** 一键套用 */
  presets?: PlaygroundPreset[]
  /** 预览区下面那行小字 */
  summary?: (state: Record<string, PlaygroundValue>) => string
  /** 预览内容是否吃满预览区宽度（输入框、滑块这类需要） */
  stretch?: boolean
}

export const SIZE_OPTIONS: SegmentOption[] = [
  { value: 'sm', label: '小' },
  { value: 'md', label: '中' },
  { value: 'lg', label: '大' },
]

/** 统一读取尺寸，非法值回落到 md。 */
export function readSize(state: Record<string, PlaygroundValue>): UiKitSize {
  const value = state.size
  return value === 'sm' || value === 'lg' ? value : 'md'
}

/** 读取布尔值，缺省给 false。 */
export function readBool(state: Record<string, PlaygroundValue>, key: string): boolean {
  return state[key] === true
}

/** 读取字符串，缺省给空串。 */
export function readText(state: Record<string, PlaygroundValue>, key: string): string {
  const value = state[key]
  if (typeof value === 'string') return value
  return value == null ? '' : String(value)
}

/** 读取数字，非法值回落到 fallback。 */
export function readNumber(
  state: Record<string, PlaygroundValue>,
  key: string,
  fallback: number,
): number {
  const value = state[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
