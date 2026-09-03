/**
 * Canvas UI Component Library
 *
 * 直接基于 ax-ui-kit 技能组件，保持原始 Material 3 设计风格。
 * 依赖：@floating-ui/vue（浮层定位）、Tailwind v4（样式）、Material Symbols（图标）。
 */

export { default as AxButton } from './AxButton.vue'
export { default as AxInput } from './AxInput.vue'
export { default as AxDropdown } from './AxDropdown.vue'
export type { DropdownTrigger } from './AxDropdown.vue'
export { default as AxSelect } from './AxSelect.vue'
export { default as AxSwitch } from './AxSwitch.vue'
export { default as AxSlider } from './AxSlider.vue'

// Notify（基于 vue-sonner 的自定义 toast：AxToast 呈现，AxToaster 为全局宿主）
export { default as AxToast } from './AxToast.vue'
export { default as AxToaster } from './AxToaster.vue'
export { notify, dismissNotify, clearNotifies, notifySuccess, notifyError, notifyInfo, notifyWarning } from './notify'
export type { AxNotifyType, AxNotifyOptions } from './notify'

// Hooks
export { useFloating } from './hooks/useFloating'
export type { UseFloatingOptions } from './hooks/useFloating'
export {
  provideTeleportTarget,
  useTeleportTarget,
  TELEPORT_TARGET_KEY,
} from './hooks/useTeleportTarget'

// 类型导出
export type {
  ControlSize,
  InputSize,
  ButtonSize,
  RoundedSize,
  ButtonVariant,
  AlertType,
  SelectOption,
  PropPanelItemType,
  PropPanelSchemaItem,
  PropPanelModel,
} from './types'

// 工具
export { ROUNDED_CLASSES, CONTROL_SIZE_CLASSES } from './common'
