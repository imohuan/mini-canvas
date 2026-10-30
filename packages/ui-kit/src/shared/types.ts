/** 组件库通用尺寸档。 */
export type UiKitSize = 'sm' | 'md' | 'lg'

/**
 * 语义色调，颜色由 Provider 的主题决定。
 *
 * `info` 是**提示/信息**一档（蓝），与 `primary`（品牌强调色）区分：
 * 前者用于「说明、同步成功但非关键」这类中性信息，后者表示「这是主操作/主状态」。
 * 它必须留在联合类型里 —— 文档示例与预览页都在用 `tone: 'info'`，
 * 少写这一档会让用户照抄示例直接类型报错，而且 notify/messages 选了 info 也没有任何视觉差别。
 */
export type UiKitTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

/** 浮层方位。带 start/end 时分别贴触发器的左/右或上/下边缘。 */
export type UiKitPlacement =
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end'
  | 'auto'

/** 空间密度：只影响间距和留白，不改变控件可点面积。 */
export type UiKitDensity = 'compact' | 'comfortable' | 'spacious'

export interface UiKitTheme {
  accent: string
  accentHover: string
  danger: string
  success: string
  warning: string
  info: string
  ink: string
  inkMuted: string
  panel: string
  panelSoft: string
  line: string
  hover: string
  chip: string
  shadow: string
}

export interface UiKitSizeToken {
  height: number
  fontSize: number
  paddingX: number
  icon: number
}

export interface UiKitContext {
  size: UiKitSize
  density: UiKitDensity
  radius: number
  theme: UiKitTheme
  sizes: Record<UiKitSize, UiKitSizeToken>
  cssVars: Record<string, string>
  zIndex: { dropdown: number; popover: number; modal: number; toast: number }
}

/** 把数字限制在范围内；NaN 回落到 fallback。 */
export function clampNumber(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}
