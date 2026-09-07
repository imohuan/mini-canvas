// plugin-multi-select —— 多选交互插件（v2 复刻老版 multi-select：自绘 Shift+拖框选 + SelectionFrame 群组框）。
export { multiSelectPlugin, name, apply, handleMultiSelectKey } from './multiSelectPlugin'
export type { MultiSelectService } from './multiSelectPlugin'
// 纯逻辑引擎（框选碰撞/包围盒/整组拖动成员；零 Vue 可单测）
export {
  hitTestRects,
  computeUnionBounds,
  paddedBounds,
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
} from './multiSelectEngine'
