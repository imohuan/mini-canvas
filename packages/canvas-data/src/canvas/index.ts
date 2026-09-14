/**
 * canvas —— 画布语义层（零 Vue，纯逻辑）。
 *
 * 这一层把"通用插件内核"长成一个画布引擎：
 * - 画布能力段：ctx.nodes / ctx.theme / ctx.commands（由 capabilities.ts 收口）
 * - 注册表：节点展示段（nodeRegistry/nodeRenderer）、主题/外观槽（themeRegistry）
 * - 画布规则：连接校验（connection）、菜单聚合（menuService）、建节点（nodeFactory）
 * - 画布上下文：Context（继承 kernel 的 Context 并默认装画布能力层）
 *
 * 依赖：kernel（插件框架 + tools/command/iconKind）+ 本包数据层（../nodeStore 等）。
 */
export { createCanvasCapabilityLayer } from './capabilityLayer'
export { buildCapabilities } from './capabilities'
export type { NodeRegisterDef, ThemeOccupantOpts, SlotRegisterReq } from './capabilities'

export { Context, canvasCapabilityLayer } from './context'

export { NodeRegistry } from './registry/nodeRegistry'
export type { NodePresentation, NodeSegment, NodeSegmentContribution } from './registry/nodeRegistry'
export { resolveSegment, hasContent, activeSegments, nodeSegmentStack } from './registry/nodeRenderer'
export { registerNodeType } from './registry/registerNodeType'
export type { NodeTypeDef } from './registry/registerNodeType'
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

export { createMenuService } from './menuService'
export type { MenuService, MenuItem, MenuArea, MenuCreatableType } from './menuService'

// 画布通用命令（建节点/删选中/撤销/重做）——宿主 boot 时经 registerCanvasCommands 注册
export { registerCanvasCommands, CANVAS_COMMAND } from './canvasCommands'
export type { CanvasCommandServices } from './canvasCommands'

export { NodeFactory } from './nodeFactory'
export type { NodeCreator, NodeFactoryService } from './nodeFactory'
