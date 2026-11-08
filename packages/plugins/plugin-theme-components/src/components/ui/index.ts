/**
 * 主题默认皮自带的组合件。
 *
 * 下拉 / 选择 / 提示不再在这里维护第二套实现：一律直接使用
 * `@mini-canvas/ui-kit-shadcn` 的分离件（DropdownMenu / Select / Tooltip …）。
 */
/** 插槽调试小点的悬停说明面板（默认主题的调试件） */
export { default as SlotDebugPopover } from './SlotDebugPopover.vue'
/** 全屏媒体预览（文本/图片/视频/音频内置，#stage 插槽可扩展新类型；详见组件头注释） */
export { default as MediaViewer } from './MediaViewer.vue'
export { default as PrecisionSlider } from './PrecisionSlider.vue'
export { default as ToolParamField } from './ToolParamField.vue'
export { default as ColorField } from './ColorField.vue'
/** 节点内容区的统一空状态（图片/视频/音频/3D 等共用；文本/说明/图标/动作都可配） */
export { default as NodeEmptyState } from './NodeEmptyState.vue'
/** 节点默认加载态（流光 + 进度；任务执行 / 视频帧图 / 后台处理共用一只） */
export { default as NodeLoadingState } from './NodeLoadingState.vue'
// 参数合并展示件：把「比例 · 画质 · 2K · 1张」这种多参数收敛成一个下拉（参考 LibTV 底行）
export { default as ToolParamGroup } from './ToolParamGroup.vue'
// 参数控件（判定表见 paramKind.ts）：
//   基础控件由 `type` 决定 —— select / grid（按钮网格）/ number（滑块或输入框）/ string / boolean；
//   专属 UI 由 `kind` 决定 —— 目前只有 ratio（按真实宽高比画小矩形的网格）。
export { default as ToolOptionGrid } from './ToolOptionGrid.vue'
export { default as ToolRatioGrid } from './ToolRatioGrid.vue'
export { default as ToolParamSlider } from './ToolParamSlider.vue'
export {
  resolvePresetKind,
  resolveBaseControl,
  drawsOwnTitle,
  PRESET_UI_NAMES,
  gridColumns,
} from './paramKind'
export type { PresetKind, BaseControl } from './paramKind'
