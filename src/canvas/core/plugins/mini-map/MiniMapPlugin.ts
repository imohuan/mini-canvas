import { createApp, h, ref } from "vue"
import type { CanvasPlugin, PluginContext } from "../types"
import MiniMap from "./MiniMap.vue"

/**
 * MiniMapPlugin — 小地图插件
 *
 * 在画布右下角显示缩略小地图，支持：
 * - 所有节点缩略显示
 * - 当前视口位置遮罩
 * - 拖拽平移画布
 * - 滚轮缩放
 */
export const MiniMapPlugin: CanvasPlugin = {
  name: "mini-map",
  version: "1.0.0",

  install(context: PluginContext) {
    let appInstance: ReturnType<typeof createApp> | null = null
    let containerEl: HTMLDivElement | null = null

    // 响应式数据，供 MiniMap 组件读取
    const miniNodes = ref(context.actions.getNodes())
    const miniViewport = ref(context.viewport.getViewport())
    const miniDims = ref({ width: 0, height: 0 })

    // 监听画布变化
    const offNodesChange = context.on("nodesChange", () => {
      miniNodes.value = context.actions.getNodes()
    })
    const offNodeDragStop = context.on("nodeDragStop", () => {
      miniNodes.value = context.actions.getNodes()
    })

    // 定时同步 viewport（没有 viewport change 事件，用 rAF 轮询）
    let rafId = 0
    function syncViewport() {
      miniViewport.value = context.viewport.getViewport()
      const el = context.dom.getViewport()
      if (el) {
        miniDims.value = { width: el.clientWidth, height: el.clientHeight }
      }
      rafId = requestAnimationFrame(syncViewport)
    }
    rafId = requestAnimationFrame(syncViewport)

    // 挂载 MiniMap
    containerEl = document.createElement("div")
    containerEl.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:10;pointer-events:auto"
    document.body.appendChild(containerEl)

    appInstance = createApp({
      render() {
        return h(MiniMap, {
          nodes: miniNodes.value,
          viewport: miniViewport.value,
          dimensions: miniDims.value,
          onPan(payload: { x: number; y: number }) {
            context.viewport.setViewport({
              x: payload.x,
              y: payload.y,
              zoom: miniViewport.value.zoom,
            })
          },
          onZoom(payload: { zoom: number }) {
            context.viewport.zoomTo(payload.zoom)
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
        offNodeDragStop()
        if (appInstance) {
          appInstance.unmount()
          appInstance = null
        }
        if (containerEl) {
          containerEl.remove()
          containerEl = null
        }
      },
    }
  },
}
