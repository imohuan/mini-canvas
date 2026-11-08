import type { ThemeLabMode } from './catalog'
import type { ThemeStudioState } from './state'

export function useThemeStudioExport(
  state: ThemeStudioState,
  deps: { colorForBase: (base: string, forMode?: ThemeLabMode) => string; showToast: (message: string) => void },
) {
  const { entries } = state
  const colorForBase = deps.colorForBase
  const showToast = deps.showToast

  const CSS_VAR_BY_BASE: Record<string, string> = {
    accentColor: '--ui-accent',
    accentHoverColor: '--ui-accent-hover',
    dangerColor: '--ui-danger',
    warnColor: '--ui-warn',
    edgeRailColor: '--ui-edge-rail',
    edgeFlowColor: '--ui-edge-flow',
    alignGuideColor: '--ui-guide',
    multiSelectBoxColor: '--ui-select-box',
    multiSelectFrameOuterColor: '--ui-select-outer',
    multiSelectFrameInnerColor: '--ui-select-inner',
    pathColor: '--edge-cutting-path-color',
    bladeColor: '--edge-cutting-blade-color',
  }

  function cssBlock(forMode: ThemeLabMode): string {
    return entries.value
      .map((entry) => {
        const name = CSS_VAR_BY_BASE[entry.id]
        if (!name) return ''
        const value = colorForBase(entry.id, forMode)
        return value ? `  ${name}: ${value};` : ''
      })
      .filter(Boolean)
      .join('\n')
  }

  function copyCss(): void {
    const css = `:root {\n${cssBlock('light')}\n}\n\nhtml.dark {\n${cssBlock('dark')}\n}`
    void navigator.clipboard
      ?.writeText(css)
      .then(() => showToast('CSS 变量已复制'))
      .catch(() => showToast('复制失败，请手动选择'))
  }

  return { copyCss }
}


