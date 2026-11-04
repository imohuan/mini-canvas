/**
 * 图标句柄 → 渲染形态。
 *
 * 主题的按钮 / 选择器接受「SVG 字符串或 Vue 组件」两种句柄（与节点 icon 同源）。
 * 判定复用内核的 iconRenderMode，保证与节点类型图标是同一套规则，不各写一份。
 */
import { computed, type Component } from 'vue'
import { iconRenderMode } from '@mini-canvas/kernel'

export interface IconHandleParts {
  mode: 'html' | 'component' | 'none'
  html: string
  component: Component | null
}

export function iconHandleParts(icon: unknown): IconHandleParts {
  const mode = iconRenderMode(icon)
  return {
    mode,
    html: mode === 'html' ? String(icon) : '',
    component: mode === 'component' ? (icon as Component) : null,
  }
}

/** 组合式版本：图标变化时自动重算。 */
export function useIconHandle(icon: () => unknown) {
  return computed(() => iconHandleParts(icon()))
}
