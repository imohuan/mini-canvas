/** 按钮外观。颜色语义由样式表统一决定，调用方只选用途。 */
export const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]

/** 按钮尺寸。交互目标最小 28px，常用档 32px。 */
export const BUTTON_SIZES = ['sm', 'md', 'lg'] as const
export type ButtonSize = (typeof BUTTON_SIZES)[number]

export interface ButtonProps {
  /** 外观：主操作、次操作、轻量操作、危险操作 */
  variant?: ButtonVariant
  /** 尺寸：小 / 中 / 大 */
  size?: ButtonSize
  /** 占满父容器宽度 */
  block?: boolean
  /** 原生 disabled；为 true 时不会触发点击 */
  disabled?: boolean
  /** 加载中；会自动禁用按钮并显示等待指示 */
  loading?: boolean
  /** 原生按钮类型，默认 button，避免放在表单里误提交 */
  type?: 'button' | 'submit' | 'reset'
  /** 纯图标按钮的无障碍名称，也是鼠标悬停提示 */
  ariaLabel?: string
  /** 原生 title 提示 */
  title?: string
  /** 是否纯图标。不传时根据「只有 icon 插槽、没有文字」自动判断 */
  iconOnly?: boolean
}

/** 只有图标时收成方形；显式 iconOnly 优先，没有显式值时由模板里的实际插槽决定。 */
export function resolveIconOnly(iconOnly: boolean | undefined, hasIcon: boolean, hasLabel: boolean): boolean {
  return iconOnly ?? (hasIcon && !hasLabel)
}
