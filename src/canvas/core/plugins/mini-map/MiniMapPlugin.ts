import { createApp, h, reactive } from "vue"
import type { CanvasPlugin, PluginContext } from "../types"
import type { PanelSettingDefinition } from "../../registry/types"
import MiniMap from "./MiniMap.vue"

export const MiniMapPlugin: CanvasPlugin = {
  name: "mini-map",
  version: "1.0.0",

  install(context: PluginContext) {
    let appInstance: ReturnType<typeof createApp> | null = null
    let containerEl: HTMLDivElement | null = null

    // 用 useValue 获取响应式配置（双向绑定到 panel）
    const widthRef = context.panels.useValue<number>("mini-map.width", null, 240)
    const heightRef = context.panels.useValue<number>("mini-map.height", null, 160)
    const sensXRef = context.panels.useValue<number>("mini-map.sensitivityX", null, 1)
    const sensYRef = context.panels.useValue<number>("mini-map.sensitivityY", null, 1)
    const visibleRef = context.panels.useValue<boolean>("mini-map.visible", null, true)

    // ---- 注册 Panel 设置 ----
    context.panels.registerSetting("mini-map", {
      id: "mini-map.width", title: "宽度", description: "小地图宽度（px）",
      type: "slider", group: "小地图", order: 10,
      defaultValue: 240, min: 120, max: 400, step: 10,
    } as PanelSettingDefinition)

    context.panels.registerSetting("mini-map", {
      id: "mini-map.height", title: "高度", description: "小地图高度（px）",
      type: "slider", group: "小地图", order: 20,
      defaultValue: 160, min: 80, max: 300, step: 10,
    } as PanelSettingDefinition)

    context.panels.registerSetting("mini-map", {
      id: "mini-map.sensitivityX", title: "X轴灵敏度", description: "拖拽时 X 轴移动倍率",
      type: "slider", group: "小地图", order: 30,
      defaultValue: 1, min: 0.1, max: 3, step: 0.1,
    } as PanelSettingDefinition)

    context.panels.registerSetting("mini-map", {
      id: "mini-map.sensitivityY", title: "Y轴灵敏度", description: "拖拽时 Y 轴移动倍率",
      type: "slider", group: "小地图", order: 40,
      defaultValue: 1, min: 0.1, max: 3, step: 0.1,
    } as PanelSettingDefinition)

    context.panels.registerSetting("mini-map", {
      id: "mini-map.visible", title: "显示小地图", description: "切换显示/隐藏",
      type: "boolean", group: "小地图", order: 50,
      defaultValue: true,
    } as PanelSettingDefinition)

    // ---- 命令 + 快捷键 ----
    context.commands.register({
      id: "mini-map.toggle",
      source: "mini-map",
      title: "切换小地图",
      run() { visibleRef.value = !visibleRef.value },
    })

    context.registerShortcut("ctrl+m", () => {
      visibleRef.value = !visibleRef.value
    }, "切换小地图")

    // ---- 画布数据 ----
    const state = reactive({
      nodes: [] as any[],
      viewport: { x: 0, y: 0, zoom: 1 },
      dimensions: { width: 0, height: 0 },
    })

    state.nodes = context.actions.getAllNodes()
    state.viewport = context.viewport.getViewport()

    function syncNodes() { state.nodes = context.actions.getAllNodes() }
    const offNodesChange = context.on("nodesChange", syncNodes)
    const offNodeDrag = context.on("nodeDrag", syncNodes)
    const offNodeDragStop = context.on("nodeDragStop", syncNodes)

    let rafId = 0
    function syncViewport() {
      state.viewport = context.viewport.getViewport()
      const el = context.dom.getViewport()
      if (el) state.dimensions = { width: el.clientWidth, height: el.clientHeight }
      rafId = requestAnimationFrame(syncViewport)
    }
    rafId = requestAnimationFrame(syncViewport)

    // ---- 挂载 ----
    containerEl = document.createElement("div")
    containerEl.style.cssText = "position:fixed;bottom:12px;right:12px;z-index:10;pointer-events:auto"
    document.body.appendChild(containerEl)

    appInstance = createApp({
      setup() {
        return () => {
          if (!visibleRef.value) {
            if (containerEl) containerEl.style.display = "none"
            return null
          }
          if (containerEl) containerEl.style.display = ""
          return h(MiniMap, {
            nodes: state.nodes,
            viewport: state.viewport,
            dimensions: state.dimensions,
            width: widthRef.value,
            height: heightRef.value,
            onPan(payload: { x: number; y: number }) {
              state.viewport = { x: payload.x, y: payload.y, zoom: state.viewport.zoom }
              context.viewport.setViewport({
                x: payload.x * sensXRef.value,
                y: payload.y * sensYRef.value,
                zoom: state.viewport.zoom,
              })
            },
            onJump(payload: { x: number; y: number }) {
              context.viewport.setCenter(payload.x, payload.y, state.viewport.zoom)
            },
          })
        }
      },
    })

    appInstance.mount(containerEl)
    context.logger.info("MiniMapPlugin mounted (Ctrl+M 切换)")

    return {
      uninstall() {
        cancelAnimationFrame(rafId)
        offNodesChange(); offNodeDrag(); offNodeDragStop()
        context.unregisterShortcut("ctrl+m")
        if (appInstance) { appInstance.unmount(); appInstance = null }
        if (containerEl) { containerEl.remove(); containerEl = null }
      },
    }
  },
}
