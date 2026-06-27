/**
 * 主题预设定义
 *
 * 每个预设包含 5 个基准色，其余 27 个 CSS 变量由 colorUtils.computeThemeVars 自动计算。
 */

import type { ThemePreset, ThemePresetName } from './types'

/** 所有内置预设的注册表 */
export const THEME_PRESETS: Record<ThemePresetName, ThemePreset> = {
  /** 默认 Slate 灰蓝主题 — 沉稳、专业 */
  slate: {
    name: 'slate',
    label: '灰蓝',
    accent: '#111827',
    surface: '#f9fafb',
    textStrong: '#111827',
    text: '#4b5563',
    textMuted: '#64748b',
  },

  /** Blue 蓝色主题 — 现代、科技感 */
  blue: {
    name: 'blue',
    label: '科技蓝',
    accent: '#1d4ed8',
    surface: '#eff6ff',
    textStrong: '#1e3a5f',
    text: '#3b6ba5',
    textMuted: '#6b8ab5',
    // 边框也跟随蓝色系
    override: {
      'canvas-node-border': 'rgb(147 179 219 / 0.95)',
      'canvas-node-border-subtle': '#d0dff0',
      'canvas-node-border-hover': '#93b3db',
      'canvas-node-resize-handle': '#93a3bf',
    },
  },

  /** Green 绿色主题 — 自然、护眼 */
  green: {
    name: 'green',
    label: '翠绿',
    accent: '#166534',
    surface: '#f0fdf4',
    textStrong: '#14532d',
    text: '#3b734e',
    textMuted: '#6b9a7a',
    override: {
      'canvas-node-border': 'rgb(134 179 155 / 0.95)',
      'canvas-node-border-subtle': '#c8e6d0',
      'canvas-node-border-hover': '#86b39b',
      'canvas-node-resize-handle': '#8aab95',
    },
  },

  /** Warm 暖色主题 — 温暖、舒适 */
  warm: {
    name: 'warm',
    label: '暖棕',
    accent: '#78350f',
    surface: '#fffbeb',
    textStrong: '#451a03',
    text: '#7c5e3a',
    textMuted: '#a0855c',
    override: {
      'canvas-node-border': 'rgb(189 157 119 / 0.95)',
      'canvas-node-border-subtle': '#e8d8c0',
      'canvas-node-border-hover': '#bd9d77',
      'canvas-node-resize-handle': '#b0a08a',
    },
  },

  /** Custom — 用户自定义 */
  custom: {
    name: 'custom',
    label: '自定义',
    accent: '#111827',
    surface: '#f9fafb',
    textStrong: '#111827',
    text: '#4b5563',
    textMuted: '#64748b',
  },
}

/** 获取所有预设列表 */
export function getPresetsList(): ThemePreset[] {
  return Object.values(THEME_PRESETS)
}

/** 获取指定预设；不存在则返回 slate */
export function getPreset(name: ThemePresetName): ThemePreset {
  return THEME_PRESETS[name] || THEME_PRESETS.slate
}
