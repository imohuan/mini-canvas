/**
 * vue-render —— 通用 Vue 渲染底座（不碰画布）。
 *
 * 这里只放"任何渲染器都能用"的东西：
 * - 应用级上下文令牌（ContextInject / 取件函数）；
 * - 通用槽宿主（SlotHost）。
 *
 * 不认识节点、连线、视口，也不 import @vue-flow/core。画布相关内容仍在 canvas-render。
 *
 * 兼容：canvas-render 继续重导出这里的公开面；现有插件 import 不用改。
 */
export {
  CANVAS_CONTEXT_KEY,
  useCanvasContext,
  useCanvasContextOrRender,
} from './context'
export type { CanvasContext } from './context'
export { default as SlotHost } from './SlotHost.vue'
