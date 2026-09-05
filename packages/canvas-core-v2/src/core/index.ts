export { Context, runPlugin } from './Context'
export type { ContextState } from './Context'
export { Scope } from './Scope'
export { topoSort, depsOf } from './topo'
export { EventBus, registerEventName } from './EventBus'
export { NodeRegistry } from './registry/nodeRegistry'
export type { NodePresentation, NodeSegment, NodeSegmentContribution } from './registry/nodeRegistry'
export { resolveSegment, hasContent, activeSegments, nodeSegmentStack } from './registry/nodeRenderer'
export { registerNodeType } from './registry/registerNodeType'
export type { NodeTypeDef } from './registry/registerNodeType'
export { ThemeRegistry } from './registry/themeRegistry'
export type { ThemeSlot, ThemePresentation, ThemeOccupantRequest } from './registry/themeRegistry'
export { registerThemeSlot } from './registry/registerThemeSlot'
export { SlotRegistry } from './registry/slotRegistry'
export type { SlotEntry, SlotAddRequest, SlotName } from './registry/slotRegistry'
export { buildCapabilities } from './capabilities'
export type { NodeRegisterDef } from './capabilities'
export {
  Lifecycle,
} from './types'
export type {
  CanvasEventMap,
  Disposable,
  EffectFn,
  EventListener,
  EventName,
  PluginModule,
  PluginScope,
  PluginCapabilities,
  Revoke,
  Services,
} from './types'
