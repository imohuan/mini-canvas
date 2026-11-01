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

/** 组件库使用标记的读取工具（只读 DOM 属性，不改变组件） */
export {
  UI_KIT_DEBUG_ATTR,
  UI_KIT_DEBUG_COMPONENT_ATTR,
  parseDebugLoc,
  usageLocOf,
} from './debugLoc'
export type { UiKitUsageLoc } from './debugLoc'
