/**
 * canvas —— 画布语义层（零 Vue，纯逻辑）。
 *
 * 这一层把"通用插件内核"长成一个画布引擎：
 * - 画布能力段：ctx.nodes / ctx.theme / ctx.commands（由 capabilities.ts 收口）
 * - 注册表：节点展示段（nodeRegistry/nodeRenderer）、主题/外观槽（themeRegistry）
 * - 画布规则：连接校验（connection）、建节点（nodeFactory）
 * - 画布上下文：Context（继承 kernel 的 Context 并默认装画布能力层）
 *
 * 依赖：kernel（插件框架 + tools/command/iconKind）+ 本包数据层（../nodeStore 等）。
 */
export { createCanvasCapabilityLayer } from './capabilityLayer'
export { buildCapabilities } from './capabilities'
export type { NodeRegisterDef, ThemeOccupantOpts, SlotRegisterReq } from './capabilities'

// 剪贴板多路仲裁（注册场 clipboard/copy|cut|paste）：复制/粘贴按 order 仲裁的纯逻辑契约。
// 宿主绑各一个原生 copy/cut/paste 监听，按 order 问各处理器谁接管（见 clipboardActions 头注释）。
export {
  CLIPBOARD_COPY_KIND,
  CLIPBOARD_COPY_KEY,
  CLIPBOARD_CUT_KEY,
  CLIPBOARD_PASTE_KIND,
  CLIPBOARD_PASTE_KEY,
  CANVAS_CLIPBOARD_MIME,
  CANVAS_CLIPBOARD_TEXT_PREFIX,
  CANVAS_CLIPBOARD_PAYLOAD_VERSION,
  buildClipboardWritePayload,
  buildClipboardPastePayload,
  dispatchClipboardWrite,
  dispatchClipboardPaste,
  hasCanvasClipboardMarker,
  canvasClipboardMarker,
  canvasClipboardPayload,
  parseCanvasClipboardText,
  readCanvasClipboardPayload,
} from './clipboardActions'
export type {
  ClipboardEntry,
  ClipboardWriteHandler,
  ClipboardWritePayload,
  ClipboardPasteHandler,
  ClipboardPastePayload,
  CanvasClipboardPayload,
} from './clipboardActions'

// 画布基础服务的集中类型登记（T03）：让按名调用（ctx.get('doc') 等）自带类型
import './serviceTypes'

// 渲染层两个内置服务（nodeLayout/viewport）的纯结构契约（作者 SDK 类型面，零 Vue/零 VueFlow）
export type {
  NodeLayoutContract,
  ViewportContract,
  LayoutRect,
  ViewportState,
  FlowPoint,
} from './renderServiceContracts'

export { Context, canvasCapabilityLayer } from './context'

export { NodeRegistry } from './registry/nodeRegistry'
export type { NodePresentation, NodeSegment, NodeSegmentContribution } from './registry/nodeRegistry'
export {
  resolveSegment,
  hasContent,
  activeSegments,
  nodeSegmentStack,
  nodeSegmentStackEntries,
} from './registry/nodeRenderer'
export type { NodeSegmentEntry } from './registry/nodeRenderer'
export {
  NODE_REGIONS,
  isRegion,
  assertRegion,
  regionKey,
  nodeRegionStackEntries,
} from './region'
export { RETIRED_SEGMENT_NAMES, RETIRED_CONTENT_FIELD, isRetiredSegmentName } from './region'
export type { NodeRegion, NodeRegionAttachment } from './region'
export { registerNodeType } from './registry/registerNodeType'
export type { NodeTypeDef } from './registry/registerNodeType'

// 节点数据契约（produces/consumes）与上游遍历（纯函数，前端/后台共用）
export {
  DataPortError,
  assertDataPortDef,
  assertDataPorts,
  readDataPort,
  isResourceRefValue,
} from './dataPorts'
export type { DataPortDef, NodeDataTypeDef } from './dataPorts'
export {
  GROUP_NODE_TYPE,
  UpstreamCycleError,
  buildParentIndex,
  directUpstreamOf,
  collectAncestors,
  topoOrderFrom,
  upstreamDepth,
} from './upstreamGraph'
export type {
  GraphNodeLike,
  GraphEdgeLike,
  UpstreamGraphInput,
  UpstreamTraversalOptions,
} from './upstreamGraph'
export { ThemeRegistry } from './registry/themeRegistry'
export type { ThemeSlot, ThemePresentation, ThemeOccupantRequest } from './registry/themeRegistry'
export { registerThemeSlot } from './registry/registerThemeSlot'

export {
  normalizeConnection,
  toCanonicalConnection,
  getCanonicalEndpoints,
  wouldCreateCycle,
  isSameConnection,
  findDuplicate,
  validateConnection,
  typeConnectionDef,
  resolveTargetInputPort,
  resolveSourceOutputPort,
} from './connection'
export type {
  ConnectionInput,
  ExistingEdge,
  NormalizedConnection,
  CanonicalEndpoints,
  PortDef,
  NodeConnectionDef,
  ValidateContext,
  InvalidReason,
  ValidationResult,
} from './connection'

// 画布通用命令（建节点/删选中/撤销/重做）——宿主 boot 时经 registerCanvasCommands 注册
export { registerCanvasCommands, CANVAS_COMMAND } from './canvasCommands'
export type { CanvasCommandServices } from './canvasCommands'

// 画布基础装配插件（步骤 4：把 15 行 ctx.inject 收进一个 core 插件；宿主只负责"建 ctx → 装它 → 装业务插件"）
export { createCanvasBasePlugin, CANVAS_BASE_PLUGIN_NAME } from './canvasBasePlugin'
export type { CanvasBaseAssembly, CanvasBaseOptions, CanvasBaseServices } from './canvasBasePlugin'

export { NodeFactory } from './nodeFactory'
export type { NodeCreator, NodeFactoryService } from './nodeFactory'
