/**
 * 组件试玩配置的公共类型与读取器。
 *
 * 每个组件在自己目录下写一份 playground.ts，声明：
 *   - 可调参数默认值（defaults）
 *   - 右侧面板控件（fields）
 *   - 一键套用的预设（presets）
 *   - 参数摘要（summary）
 *
 * 文档 docs.md 和配置 playground.ts 都放在组件目录里，删掉组件时它们一起走。
 */

import type { UiKitSize } from '../shared/types'

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
  /** 与 catalog / 文档一致 */
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
