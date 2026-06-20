import { createApp, h, reactive } from "vue"
import type { CanvasPlugin, PluginContext } from "../types"
import MiniMap from "./MiniMap.vue"

/**
 * MiniMapPlugin — 小地图插件
 */
export const MiniMapPlugin: CanvasPlugin = {
  name: "mini-map",
  version: "1.0.0",

  install(context: PluginContext) {
    let appInstance: ReturnType<typeof createApp> | null = null
    let containerEl: HTMLDivElement | null = null

    // 用 reactive 包裹简单对象，直接响应式
    const state = reactive({
      nodes: [] as any[],
      viewport: { x: 0, y: 0, zoom: 1 },
      dimensions: { width: 0, height: 0 },
    })

    // 初始化
    state.nodes = context.actions.getNodes()
    state.viewport = context.viewport.getViewport()

    function syncNodes() {
      state.nodes = context.actions.getNodes()
    }

    const offNodesChange = context.on("nodesChange", syncNodes)
    const offNodeDrag = context.on("nodeDrag", syncNodes)
    const offNodeDragStop = context.on("nodeDragStop", syncNodes)

    // rAF 同步 viewport + dimensions
    let rafId = 0
    function syncViewport() {
      const vp = context.viewport.getViewport()
      state.viewport = vp
      const el = context.dom.getViewport()
      if (el) {
        state.dimensions = { width: el.clientWidth, height: el.clientHeight }
      }
      rafId = requestAnimationFrame(syncViewport)
    }
    rafId = requestAnimationFrame(syncViewport)

    // 挂载
    containerEl = document.createElement("div")
    containerEl.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:10;pointer-events:auto"
    document.body.appendChild(containerEl)

    appInstance = createApp({
      setup() {
        return () => h(MiniMap, {
          nodes: state.nodes,
          viewport: state.viewport,
          dimensions: state.dimensions,
          onPan(payload: { x: number; y: number }) {
            state.viewport = { x: payload.x, y: payload.y, zoom: state.viewport.zoom }
            context.viewport.setViewport({ x: payload.x, y: payload.y, zoom: state.viewport.zoom })
          },
          onZoom(payload: { zoom: number }) {
            context.viewport.zoomTo(payload.zoom)
          },
          onJump(payload: { x: number; y: number }) {
            context.viewport.setCenter(payload.x, payload.y, state.viewport.zoom)
          },
        })
      },
    })

    appInstance.mount(containerEl)
    context.logger.info("MiniMapPlugin mounted")

    return {
      uninstall() {
        cancelAnimationFrame(rafId)
        offNodesChange()
        offNodeDrag()
        offNodeDragStop()
        if (appInstance) { appInstance.unmount(); appInstance = null }
        if (containerEl) { containerEl.remove(); containerEl = null }
      },
    }
  },
}
