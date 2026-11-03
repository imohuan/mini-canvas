import { computed } from 'vue'
import { currentThemeMode } from '@mini-canvas/canvas-render'
import { PLUGIN_LABELS, SCENE_META } from '../catalog'
import type { ThemeLabColorEntry, ThemeLabScene } from '../catalog'
import type { ThemeLabState } from './state'

export function useThemeLabDisplay(
  state: ThemeLabState,
  deps: { valueOf: (entry: ThemeLabColorEntry) => string },
) {
  const { available, enabledPlugins } = state
  const valueOf = deps.valueOf

  function chipStyle(entry: ThemeLabColorEntry): Record<string, string> {
    const color = valueOf(entry) || '#0891b2' // 主题色白名单: 独立预览页的兜底色（真实颜色始终来自 settings）
    return { '--chip': color, '--chip-ink': inkFor(color) }
  }

  function inkFor(hex: string): string {
    const value = hex.replace('#', '').slice(0, 6)
    if (value.length !== 6) return '#fff' // 主题色白名单: 对比度计算的兜底返回值
    const r = parseInt(value.slice(0, 2), 16) / 255
    const g = parseInt(value.slice(2, 4), 16) / 255
    const b = parseInt(value.slice(4, 6), 16) / 255
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? '#12201c' : '#fff' // 主题色白名单: 对比度计算选黑/白字，属几何常量
  }

  function chipStatus(entry: ThemeLabColorEntry): string {
    if (!entry.bound) return '未绑定画布目标'
    if (available.get(entry.id)) return valueOf(entry) || '跟随主题'
    return entry.inactiveHint || '当前场景里没有这个元素'
  }

  function sceneHint(id: ThemeLabScene): string {
    const meta = SCENE_META.find((item) => item.id === id)
    if (meta?.plugin && !enabledPlugins.value.includes(meta.plugin)) {
      return '需要安装 ' + (PLUGIN_LABELS[meta.plugin] ?? meta.plugin)
    }
    return meta?.hint ?? ''
  }

  /** 当前页面是否亮色（用于 CSS 变量兜底，避免工作台自身写死配色） */
  const pageMode = computed(() => currentThemeMode())

  return { chipStyle, chipStatus, sceneHint, pageMode }
}
