import type { UiKitDensity, UiKitSize, UiKitSizeToken, UiKitTheme } from '../shared/types'

export interface UiKitProviderProps {
  /** 默认尺寸，单个组件可以用 size 覆盖 */
  size?: UiKitSize
  /** 密度：只改间距和留白 */
  density?: UiKitDensity
  /** 控件圆角，单位 px */
  radius?: number
  /** 主题名称，写到 data-ui-kit-theme 方便宿主扩展 */
  themeName?: string
  /** 深色主题 */
  dark?: boolean
  /** 主题色；传了就覆盖内置的青色 */
  accent?: string
  accentHover?: string
  danger?: string
  success?: string
  warning?: string
  info?: string
  /** 覆盖尺寸比例：高度、字号、左右内边距、图标尺寸 */
  sizes?: Partial<Record<UiKitSize, Partial<UiKitSizeToken>>>
  /** 浮层层级基准，连续弹出的通知/对话框可从这上面再加 */
  zIndexBase?: number
}

export interface ResolvedUiKitTheme extends UiKitTheme {}
