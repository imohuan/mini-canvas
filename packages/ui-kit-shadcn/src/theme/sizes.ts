/**
 * 组件尺寸档位（**纯数据，唯一事实源**）。
 *
 * 为什么要有这一层：
 * shadcn 每个组件的 size 只影响自己（Button 有 8 档、Select 只有 2 档、Input 根本没有
 * size prop）。用户要的是「在主题里选一次，全站控件一起变」，逐组件传参做不到。
 *
 * 做法：把每个档位翻译成一组 CSS 变量（`--mct-size-*`），组件库在自己的
 * `styles/size.css` 里统一消费。默认档的值与 shadcn 原始样式逐字一致，
 * 所以「不选」时看不出任何变化；选了紧凑 / 舒适 / 大，按钮、输入框、下拉、
 * 开关、页签、菜单行、卡片一起缩放，层次仍按各自的 size 保留。
 */
export interface SizeOption {
  id: 'compact' | 'default' | 'comfortable' | 'large'
  label: string
  hint: string
  /** 写进 `<html>` 的变量表；键是完整的 `--mct-size-*` 名 */
  vars: Readonly<Record<string, string>>
}

/** 三档控件的公共变量名（default / sm / xs） */
function scale(control: {
  height: string
  heightSm: string
  heightXs: string
  padX: string
  padXSm: string
  padXXs: string
  fontSize: string
  fontSizeSm: string
  fontSizeXs: string
  icon: string
  iconSm: string
  iconXs: string
  rowPy: string
  rowPx: string
  cardGap: string
  cardPy: string
  tabHeight: string
  switchHeight: string
  switchWidth: string
  switchThumbHeight: string
  switchThumbWidth: string
  check: string
  sliderTrack: string
  sliderThumbHeight: string
  sliderThumbWidth: string
}): Record<string, string> {
  return {
    '--mct-size-control-h': control.height,
    '--mct-size-control-h-sm': control.heightSm,
    '--mct-size-control-h-xs': control.heightXs,
    '--mct-size-control-px': control.padX,
    '--mct-size-control-px-sm': control.padXSm,
    '--mct-size-control-px-xs': control.padXXs,
    '--mct-size-control-fs': control.fontSize,
    '--mct-size-control-fs-sm': control.fontSizeSm,
    '--mct-size-control-fs-xs': control.fontSizeXs,
    '--mct-size-icon': control.icon,
    '--mct-size-icon-sm': control.iconSm,
    '--mct-size-icon-xs': control.iconXs,
    '--mct-size-row-py': control.rowPy,
    '--mct-size-row-px': control.rowPx,
    '--mct-size-card-gap': control.cardGap,
    '--mct-size-card-py': control.cardPy,
    '--mct-size-tab-h': control.tabHeight,
    '--mct-size-switch-h': control.switchHeight,
    '--mct-size-switch-w': control.switchWidth,
    '--mct-size-switch-thumb-h': control.switchThumbHeight,
    '--mct-size-switch-thumb-w': control.switchThumbWidth,
    '--mct-size-check': control.check,
    '--mct-size-slider-track': control.sliderTrack,
    '--mct-size-slider-thumb-h': control.sliderThumbHeight,
    '--mct-size-slider-thumb-w': control.sliderThumbWidth,
  }
}

export const SIZE_OPTIONS: SizeOption[] = [
  {
    id: 'compact',
    label: '紧凑',
    hint: '控件 28px，适合信息密度高的面板',
    vars: scale({
      height: '1.75rem',
      heightSm: '1.5rem',
      heightXs: '1.25rem',
      padX: '0.625rem',
      padXSm: '0.5rem',
      padXXs: '0.5rem',
      fontSize: '0.8125rem',
      fontSizeSm: '0.75rem',
      fontSizeXs: '0.6875rem',
      icon: '0.875rem',
      iconSm: '0.75rem',
      iconXs: '0.625rem',
      rowPy: '0.375rem',
      rowPx: '0.625rem',
      cardGap: '1rem',
      cardPy: '1rem',
      tabHeight: '1.75rem',
      switchHeight: '1rem',
      switchWidth: '2.25rem',
      switchThumbHeight: '0.75rem',
      switchThumbWidth: '1.125rem',
      check: '0.875rem',
      sliderTrack: '0.375rem',
      sliderThumbHeight: '0.875rem',
      sliderThumbWidth: '1.25rem',
    }),
  },
  {
    id: 'default',
    label: '标准（当前）',
    hint: 'shadcn 原始尺寸：按钮 36 / 小按钮 32 / 图标 32',
    vars: scale({
      height: '2.25rem',
      heightSm: '2rem',
      heightXs: '1.5rem',
      padX: '0.75rem',
      padXSm: '0.75rem',
      padXXs: '0.625rem',
      fontSize: '0.875rem',
      fontSizeSm: '0.875rem',
      fontSizeXs: '0.75rem',
      icon: '1rem',
      iconSm: '1rem',
      iconXs: '0.75rem',
      rowPy: '0.5rem',
      rowPx: '0.75rem',
      cardGap: '1.5rem',
      cardPy: '1.5rem',
      tabHeight: '2.25rem',
      switchHeight: '1.25rem',
      switchWidth: '2.75rem',
      switchThumbHeight: '1rem',
      switchThumbWidth: '1.5rem',
      check: '1rem',
      sliderTrack: '0.5rem',
      sliderThumbHeight: '1rem',
      sliderThumbWidth: '1.5rem',
    }),
  },
  {
    id: 'comfortable',
    label: '舒适',
    hint: '控件 40px，点击区域更大',
    vars: scale({
      height: '2.5rem',
      heightSm: '2.25rem',
      heightXs: '1.75rem',
      padX: '0.875rem',
      padXSm: '0.75rem',
      padXXs: '0.625rem',
      fontSize: '0.9375rem',
      fontSizeSm: '0.875rem',
      fontSizeXs: '0.75rem',
      icon: '1.125rem',
      iconSm: '1rem',
      iconXs: '0.75rem',
      rowPy: '0.625rem',
      rowPx: '0.875rem',
      cardGap: '1.75rem',
      cardPy: '1.75rem',
      tabHeight: '2.5rem',
      switchHeight: '1.5rem',
      switchWidth: '3.25rem',
      switchThumbHeight: '1.25rem',
      switchThumbWidth: '1.75rem',
      check: '1.125rem',
      sliderTrack: '0.625rem',
      sliderThumbHeight: '1.25rem',
      sliderThumbWidth: '1.75rem',
    }),
  },
  {
    id: 'large',
    label: '大',
    hint: '控件 44px，适合触屏 / 演示',
    vars: scale({
      height: '2.75rem',
      heightSm: '2.5rem',
      heightXs: '2rem',
      padX: '1rem',
      padXSm: '0.875rem',
      padXXs: '0.75rem',
      fontSize: '1rem',
      fontSizeSm: '0.9375rem',
      fontSizeXs: '0.8125rem',
      icon: '1.25rem',
      iconSm: '1.125rem',
      iconXs: '0.875rem',
      rowPy: '0.75rem',
      rowPx: '1rem',
      cardGap: '2rem',
      cardPy: '2rem',
      tabHeight: '2.75rem',
      switchHeight: '1.75rem',
      switchWidth: '3.75rem',
      switchThumbHeight: '1.5rem',
      switchThumbWidth: '2rem',
      check: '1.25rem',
      sliderTrack: '0.75rem',
      sliderThumbHeight: '1.5rem',
      sliderThumbWidth: '2rem',
    }),
  },
]

/** 档位 id → 变量表；不认识的 id 回落到标准档（不抛错） */
export function sizeCssVars(id: string): Readonly<Record<string, string>> {
  return (SIZE_OPTIONS.find((s) => s.id === id) ?? SIZE_OPTIONS[1]!).vars
}

