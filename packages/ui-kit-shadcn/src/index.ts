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
export * from './components/ui/select'
export * from './components/ui/separator'
export * from './components/ui/sheet'
export * from './components/ui/slider'
export * from './components/ui/switch'
export * from './components/ui/tabs'
export * from './components/ui/textarea'
export * from './components/ui/tooltip'
export * from './components/color-picker'
export { SettingsRow, SettingsSection } from './components/settings'

export { SHADCN_COMPONENTS, SHADCN_COMPONENT_NAMES } from './registry'
/** 家族名单：组件库使用标记只认这些 shadcn 生成组件（详见文件头注释） */
export { SHADCN_FAMILY_NAMES, isShadcnPrimitive } from './shadcnFamilies'

/**
 * 外观选项表（字体 / 圆角）：**组件库是唯一真源**，主题插件引用它、不另抄一份。
 * 预览页与真实应用的选项因此永远同步（此前两边各写一份，已经漂移）。
 */
export { FONT_OPTIONS, HEADING_OPTIONS, RADIUS_OPTIONS, findFont, loadFont } from './theme/fonts'
export type { FontOption, RadiusOption } from './theme/fonts'
export { BASE_COLORS, THEME_COLORS, CHART_COLORS, resolveThemeVars, previewColor } from './theme/colors'
export type { BaseColor, ThemeColor, ChartColor, ThemeSelection, ThemePalette } from './theme/colors'

/** 组件库使用标记的读取工具（只读 DOM 属性，不改变组件） */
export {
  UI_KIT_DEBUG_ATTR,
  UI_KIT_DEBUG_COMPONENT_ATTR,
  parseDebugLoc,
  usageLocOf,
  withUiKitDebugMark,
} from './debugLoc'
export type { UiKitUsageLoc } from './debugLoc'
