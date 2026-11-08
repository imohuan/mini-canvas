import type { Component } from 'vue'
import { Frame, Link2, Palette, PenTool, ScanLine, Scissors, Sparkles, SquareDashed, Trash2, TriangleAlert, Waypoints, Zap } from 'lucide-vue-next'
import type { ThemeLabColorEntry, ThemeLabGroup } from './catalog'
import type { ThemeStudioState } from './state'

export function useThemeStudioDisplay(
  state: ThemeStudioState,
  deps: { valueOf: (entry: ThemeLabColorEntry) => string; inkFor: (hex: string) => string },
) {
  const valueOf = deps.valueOf
  const inkFor = deps.inkFor

  const GROUP_ICONS: Record<ThemeLabGroup, Component> = {
    品牌: Sparkles,
    连线: Waypoints,
    选择: SquareDashed,
    切割: Scissors,
    其它: Palette,
  }

  const GROUP_HINTS: Record<ThemeLabGroup, string> = {
    品牌: '按钮与状态',
    连线: '连线与流光',
    选择: '框选与参考线',
    切割: '轨迹与刀锋',
    其它: '扩展颜色',
  }

  function groupIcon(group: ThemeLabGroup): Component {
    return GROUP_ICONS[group] ?? Palette
  }

  function groupHint(group: ThemeLabGroup): string {
    return GROUP_HINTS[group] ?? ''
  }

  /** 每个色签中心的小图标：让“这个颜色用在哪”一眼能认出来。 */
  function tokenIcon(entry: ThemeLabColorEntry): Component {
    if (entry.id === 'accentColor' || entry.id === 'accentHoverColor') return Zap
    if (entry.id === 'dangerColor') return Trash2
    if (entry.id === 'warnColor') return TriangleAlert
    if (entry.id === 'edgeRailColor') return Link2
    if (entry.id === 'edgeFlowColor') return Sparkles
    if (entry.id === 'alignGuideColor') return ScanLine
    if (entry.id === 'multiSelectBoxColor') return Frame
    if (entry.id.startsWith('multiSelectFrame')) return SquareDashed
    if (entry.id === 'pathColor') return PenTool
    if (entry.id === 'bladeColor') return Scissors
    return Palette
  }

  function tokenInk(entry: ThemeLabColorEntry): string {
    return inkFor(valueOf(entry))
  }

  /** 色签下面只放得下短名；全名仍留在 title / 无障碍名称里。 */
  function shortLabel(entry: ThemeLabColorEntry): string {
    if (entry.id === 'accentHoverColor') return '悬停色'
    if (entry.id === 'multiSelectBoxColor') return '绘制框'
    if (entry.id === 'multiSelectFrameOuterColor') return '外框'
    if (entry.id === 'multiSelectFrameInnerColor') return '内框'
    if (entry.id === 'alignGuideColor') return '参考线'
    if (entry.id === 'pathColor') return '切割轨迹'
    if (entry.id === 'bladeColor') return '刀锋'
    return entry.label
  }

  /** 色签下面的短提示：说清它会在预览的哪一层生效。 */
  function targetHint(entry: ThemeLabColorEntry): string {
    if (entry.group === '连线') return entry.id === 'edgeFlowColor' ? '流光' : '连线'
    if (entry.id === 'alignGuideColor') return '参考线'
    if (entry.group === '切割') return entry.id === 'bladeColor' ? '刀锋' : '轨迹'
    if (entry.group === '选择') return entry.id === 'multiSelectBoxColor' ? '绘制框' : '多选框'
    if (entry.id === 'warnColor') return '警示状态'
    if (entry.id === 'dangerColor') return '危险状态'
    return '主按钮'
  }

  return { groupIcon, groupHint, tokenIcon, tokenInk, shortLabel, targetHint }
}


