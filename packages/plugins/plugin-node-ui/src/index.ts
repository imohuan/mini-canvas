// plugin-node-ui —— 「AI 可视化节点」插件包统一出口
/// <reference types="vite/client" />
export { nodeUiPlugin, UI_NODE_TYPE, UI_DATA_KEYS, buildNodeContext } from './nodeUiPlugin'
export type { UiNodeService } from './nodeUiPlugin'
export { fetchBackendOrigin } from './uiOrigin'
export type { FetchLike } from './uiOrigin'
export {
  extractHtml,
  normalizeInputs,
  normalizeUpstream,
  serializeForScript,
  buildSrcdoc,
  buildCsp,
  UI_INPUT_TYPES,
  UI_INPUT_TYPE_LABELS,
} from './uiData'
export type { UiInputDecl, UiInputType, UpstreamItem } from './uiData'
export { normalizeManualValues, resolveInputValues } from './uiValues'
export { currentCanvasId, readUiConfig, resolveBaseUrl } from './uiConfig'

// —— 开发期热重载（HMR）：本包任一源码（逻辑 .ts 或组件 .vue）一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
if (import.meta.hot) {
  import.meta.hot.accept((mod) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    const next = mod as { nodeUiPlugin?: unknown } | undefined
    if (next?.nodeUiPlugin) api.reloadPlugin('node-ui', next.nodeUiPlugin)
  })
}

