/**
 * @mini-canvas/ui-kit-shadcn 的唯一入口。
 *
 * 全部导出都是 shadcn-vue 生成文件的**原样转发**，没有适配层。
 * 样式由使用方按需引入 `@mini-canvas/ui-kit-shadcn/styles.css`。
 */
export * from './components/ui/alert-dialog'
export * from './components/ui/badge'
export * from './components/ui/button'
export * from './components/ui/card'
export * from './components/ui/checkbox'
export * from './components/ui/combobox'
export * from './components/ui/command'
export * from './components/ui/context-menu'
export * from './components/ui/dialog'
export * from './components/ui/dropdown-menu'
export * from './components/ui/input'
export * from './components/ui/input-group'
export * from './components/ui/label'
export * from './components/ui/menubar'
export * from './components/ui/number-field'
export * from './components/ui/popover'
export * from './components/ui/radio-group'
export * from './components/ui/scroll-area'
export * from './components/ui/select'
export * from './components/ui/separator'
export * from './components/ui/sheet'
export * from './components/ui/slider'
export * from './components/ui/switch'
export * from './components/ui/tabs'
export * from './components/ui/textarea'
export * from './components/ui/tooltip'
export * from './components/color-picker'
export { UiToaster } from './components/notification'

export { SHADCN_COMPONENTS, SHADCN_COMPONENT_NAMES } from './registry'
/** 浮层几何：箭头高度 / 可见间距（读全局组件配置）。 */
export {
  popupArrowVisible,
  popupDirectArrowSideOffset,
  popupSideOffset,
  popupSubSideOffset,
} from './theme/popup/popupConfig'
export type { PopupKind } from './theme/popup/popupConfig'

/**
 * 组件配置：全局默认值（size / 箭头 / 间距 / 外推量）的唯一入口。
 * size 由注册薄层注入给声明了 size prop 的组件；其余项由组件读这份响应式配置。
 */
export {
  COMPONENT_SIZE_CHOICES,
  DEFAULT_COMPONENT_CONFIG,
  componentConfig,
  popupTotalGap,
  resetComponentConfig,
  setComponentConfig,
} from './componentConfig'
export type { ComponentConfig, ComponentSize } from './componentConfig'
export { declaresSizeProp, withComponentConfig } from './withComponentConfig'
/** 家族名单：组件库使用标记只认这些 shadcn 生成组件（详见文件头注释） */
export { SHADCN_FAMILY_NAMES, isShadcnPrimitive } from './shadcnFamilies'

/**
 * 外观选项表（字体 / 圆角）：**组件库是唯一真源**，主题插件引用它、不另抄一份。
 * 预览页与真实应用的选项因此永远同步（此前两边各写一份，已经漂移）。
 */
export { FONT_OPTIONS, RADIUS_OPTIONS, findFont, findRadius, loadFont } from './theme/fonts'
export type { FontOption, RadiusOption } from './theme/fonts'
export { BASE_COLORS, THEME_COLORS, resolveThemeVars, previewColor } from './theme/colors'
export type { BaseColor, ThemeColor, ThemeSelection, ThemePalette } from './theme/colors'

/** 组件库使用标记的读取工具（只读 DOM 属性，不改变组件） */
export {
  UI_KIT_DEBUG_ATTR,
  UI_KIT_DEBUG_COMPONENT_ATTR,
  parseDebugLoc,
  usageLocOf,
  withUiKitDebugMark,
} from './debugLoc'
export type { UiKitUsageLoc } from './debugLoc'
