// plugin-group —— 分组插件统一出口
/// <reference types="vite/client" />
export { groupPlugin, name, apply, GroupService, GROUP_NODE_TYPE, GROUP_DEFAULT_SIZE } from './groupPlugin'
export type { GroupServiceAPI } from './groupPlugin'
export {
  computeGroupBounds,
  toRelativePosition,
  toAbsolutePosition,
  rectIntersectsGroup,
  resolveGroupChanges,
  createGroupId,
  selectDownloadableGroupChildren,
  getNodeType,
  resolveGroupBackgroundColor,
  GROUP_COLOR_SWATCHES,
  DEFAULT_GROUP_BACKGROUND_COLOR,
} from './groupEngine'
export type { GroupRect, GroupBounds, GroupMembershipCandidate, GroupColorSwatch } from './groupEngine'

// —— 开发期热重载（HMR）：本包任一源码(逻辑 .ts 或组件 .vue)一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    const next = mod as { groupPlugin?: unknown } | undefined
    if (next?.groupPlugin) api.reloadPlugin('group', next.groupPlugin)
  })
}
