/**
 * vue-render —— 通用 Vue 渲染底座（不碰画布）。
 *
 * 这里只放"任何渲染器都能用"的东西：
 * - 应用级上下文令牌（ContextInject / 取件函数）；
 * - 通用槽宿主（SlotHost / SlotComposer / SlotAnchor）；
 * - 设计系统组件目录（uiCatalog，按名取件）；
 * - 层叠带数值（LAYERS，z-index 唯一事实源）；
 * - 可替换设置面板的宿主与外壳（SettingsHost / SettingsShell）。
 *
 * 不认识节点、连线、视口，也不 import @vue-flow/core。画布相关内容仍在 canvas-render。
 *
 * 兼容：canvas-render 继续重导出这里的公开面；现有插件 import 不用改。
 */
export { CANVAS_CONTEXT_KEY, useCanvasContext, useCanvasContextOrRender } from './context'
export type { CanvasContext, ContextWithSlots } from './context'
export { default as SlotHost } from './SlotHost.vue'
// 可排序槽：内置 UI（SlotAnchor）与插件条目（ctx.slots）一起按 order + before/after 排
export { default as SlotComposer } from './components/SlotComposer.vue'
export { default as SlotAnchor } from './components/SlotAnchor.vue'
export { isSlotItemId, isSlotName, mergeSlotEntries } from './components/slotComposer'
export type { SlotComposerEntry } from './components/slotComposer'
// 设计系统组件目录（§4.5 / 案例 4）：按名取"希望被主题整体换掉"的通用件
export {
  useUiComponent,
  useUiComponentRefs,
  uiComponentRefs,
  uiComponent,
  uiNames,
  UI_NAMES,
  uiComponentOutside,
  setUiCatalogHost,
  setStaticUiCatalog,
  uiComponentStatic,
  uiStaticNames,
} from './contracts/uiCatalog'
export type { UiComponentHandle, UiComponentRefs, UiSelectOption } from './contracts/uiCatalog'
// 层叠带（z-index 唯一事实源）：所有层级数值从这里取
export { LAYERS } from './contracts/layers'
export type { LayerName } from './contracts/layers'
// 可替换设置面板：宿主提供外壳（遮罩/居中/✕/Esc/浮动窗），槽里的皮只渲染内容区
export { default as SettingsHost } from './components/SettingsHost.vue'
export { default as SettingsShell } from './components/SettingsShell.vue'
export { settingsSourceFrom } from './components/settingsSource'
export type { SettingsPanelSource, SettingSchema, SettingEntry } from './components/settingsPanelTypes'
export { default as RenderProvider } from './RenderProvider.vue'
export {
  RENDER_SHELL_KEY,
  type RenderBootstrapResult,
  type RenderSession,
  type RenderShell,
} from './shell'
