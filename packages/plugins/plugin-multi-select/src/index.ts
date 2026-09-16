// plugin-multi-select —— 多选交互插件（v2 复刻老版 multi-select：自绘 Shift+拖框选 + SelectionFrame 群组框）。
export { multiSelectPlugin, name, apply, handleMultiSelectKey, Config } from './multiSelectPlugin'
export type { MultiSelectService } from './multiSelectPlugin'
// 纯逻辑引擎（框选碰撞/包围盒/整组拖动成员；零 Vue 可单测）
export {
  hitTestRects,
  computeUnionBounds,
  paddedBounds,
  computeSelectionFrameGeometry,
  DEFAULT_SELECTION_FRAME_INNER_PADDING,
  draggableMembers,
  rectsOverlap,
  hasSelectedAncestor,
  toRects,
  DEFAULT_SELECTION_FRAME_PADDING,
} from './multiSelectEngine'
export type {
  MultiSelectRect,
  MultiSelectNodeLike,
  FlowBox,
  SelectionFramePadding,
  SelectionFrameGeometry,
} from './multiSelectEngine'
// 群组框外观配置（内外双框的间距 + 样式；零 Vue 可单测）
export {
  applyMultiSelectFrameChange,
  framePaddingsOf,
  frameStrokeCss,
  hexToRgba,
  resolveMultiSelectFrameConfig,
  MULTI_SELECT_FRAME_KEYS,
  FRAME_LINE_STYLE_OPTIONS,
  DEFAULT_MULTI_SELECT_FRAME,
} from './multiSelectConfig'
export type {
  MultiSelectConfig,
  MultiSelectFrameConfig,
  FramePaddings,
  FrameStrokeStyle,
  FrameLineStyle,
  ConfigGetter,
} from './multiSelectConfig'
