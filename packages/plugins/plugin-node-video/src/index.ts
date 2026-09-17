// plugin-node-video —— video 节点插件包统一出口
/// <reference types="vite/client" />
export { nodeVideoPlugin, VIDEO_NODE_TYPE } from './nodeVideoPlugin'
export type { VideoNodeService } from './nodeVideoPlugin'

// 纯逻辑出口（供别的包/工具复用，也便于单测直接引用）
export { cropVideo, clipVideo, captureFrameNode, createVideoOps, loadVideo, uploadVideo } from './videoOps'
export { DEFAULT_VIDEO_FIT_LIMITS, fitVideoCardSize, readVideoFitLimits } from './videoFit'
export { clampClipRange, MIN_CLIP_DURATION, readClipRange } from './videoClip'
export { framingStyle, isCroppedRect } from './videoCrop'
export type { Rect } from './videoCrop'
export { formatTime, describeVideoMeta, downloadFileName } from './videoNodeData'
export { beginOverlay, endOverlay, isClipping, isCropping } from './videoSession'

// —— 开发期热重载（HMR）：本包源码一改，vite 触发本 accept →
//    经 window.MiniCanvas.reloadPlugin 先卸旧再装新，让改动在运行中的画布里实时生效。
//    仅 dev（import.meta.hot 存在）生效；打包产物无此代码。
if (import.meta.hot) {
  import.meta.hot.accept(['./nodeVideoPlugin'], ([newMod]) => {
    const api = (globalThis as { MiniCanvas?: { reloadPlugin(n: string, mod: unknown): void } }).MiniCanvas
    if (!api) return
    const mod = (newMod as { nodeVideoPlugin?: unknown } | undefined)?.nodeVideoPlugin
    if (mod) api.reloadPlugin('video', mod)
  })
}
