/**
 * UI 通用组件库（Dropdown / Select ……）—— 主题默认皮肤使用。
 * 不导出样式 token；样式跟随项目 UI 规范。
 */
export { default as Dropdown } from './Dropdown.vue'
export { default as Tooltip } from './Tooltip.vue'
/** 插槽调试小点的悬停说明面板（默认主题的调试件） */
export { default as SlotDebugPopover } from './SlotDebugPopover.vue'
export { default as Select } from './Select.vue'
/** 全屏媒体预览（文本/图片/视频/音频内置，#stage 插槽可扩展新类型；详见组件头注释） */
export { default as MediaViewer } from './MediaViewer.vue'
export type { DropdownTrigger, SelectOption } from './types'
export type { ToolbarMenuNode } from './types'
export { default as PrecisionSlider } from './PrecisionSlider.vue'
export { default as ToolParamField } from './ToolParamField.vue'
export { default as ColorField } from './ColorField.vue'
// 节点上/下插槽里的通用按钮（插件放按钮不必再自绘一套 32×32/圆角/hover/focus）
export { default as NodeToolbarButton } from './NodeToolbarButton.vue'
/** 工具栏下拉按钮（触发器 = 主题 button；菜单与二级菜单都是独立浮层） */
export { default as ToolbarDropdownButton } from './ToolbarDropdownButton.vue'
/** 节点内容区的统一空状态（图片/视频/音频/3D 等共用；文本/说明/图标/动作都可配） */
export { default as NodeEmptyState } from './NodeEmptyState.vue'
// 参数合并展示件：把「比例 · 画质 · 2K · 1张」这种多参数收敛成一个下拉（参考 LibTV 底行）
export { default as ToolParamGroup } from './ToolParamGroup.vue'
// 参数预设件（「按参数类型自动选组件」的那一层，判定表见 paramKind.ts）：
//   ratio → 比例网格（带按真实宽高比画的描边矩形）；quality/resolution/background/count/… → 按钮网格；
//   duration（两档）→ 按钮网格；duration（连续）/ speed → 滑块。
export { default as ToolOptionGrid } from './ToolOptionGrid.vue'
export { default as ToolRatioGrid } from './ToolRatioGrid.vue'
export { default as ToolParamSlider } from './ToolParamSlider.vue'
export { resolvePresetKind, PRESET_UI_NAMES, presetColumns } from './paramKind'
export type { PresetKind } from './paramKind'
