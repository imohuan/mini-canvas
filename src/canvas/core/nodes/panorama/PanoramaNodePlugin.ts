import { markRaw } from "vue"
import type { Node } from "@vue-flow/core"
import { PanoramaNode } from "./index"
import PanoramaUploadButton from "./PanoramaUploadButton.vue"
import type { CanvasPlugin, PluginContext } from "../../plugins/types"
import type { CommandContext } from "../../registry/types"

const fullscreenSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
const resetSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`
const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

async function handlePanoramaUpload(ctx: CommandContext, args?: unknown) {
  const file = (args as { file?: File })?.file
  if (!file) return
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return
  const imageUrl = URL.createObjectURL(file)
  const assetManager = runtime.getPluginAPI?.("storage")?.assets
  let assetId: string | undefined
  if (assetManager) {
    try { assetId = await assetManager.saveAsset(file, file.name, file.type) }
    catch (err) { ctx.logger.error("保存全景图资产失败:", err) }
  }
  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  vf.updateNode(nodeId, {
    data: { ...(node?.data ?? {}), assetId, imageUrl, imageName: file.name, imageType: file.type, label: file.name },
  })
}

function handlePanoramaFullscreen(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return
  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  const wasFullscreen = !!(node?.data as any)?._fullscreen
  vf.updateNode(nodeId, { data: { ...(node?.data ?? {}), _fullscreen: !wasFullscreen } })
}

function handlePanoramaReset(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const nodeId = ctx.node?.id
  if (!vf || !nodeId) return
  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
  vf.updateNode(nodeId, {
    data: { ...(node?.data ?? {}), imageUrl: undefined, panoUrl: undefined, label: "360全景", _editing: false, _fullscreen: false },
  })
}

function handlePanoramaDownload(ctx: CommandContext) {
  const node = ctx.node
  if (!node) return
  const url = ((node.data as any)?.imageUrl as string) || ((node.data as any)?.panoUrl as string)
  if (!url) return
  const a = document.createElement("a")
  a.href = url
  a.download = (node.data as any)?.imageName || "panorama.jpg"
  a.click()
}

export const PanoramaNodePlugin: CanvasPlugin = {
  name: "node:panorama",
  version: "1.0.0",

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: "panorama", node: markRaw(PanoramaNode), label: "360全景",
      defaultSize: { cardWidth: 640, cardHeight: 400 },
      menuItem: { label: "360全景", description: "创建360全景图片查看节点", icon: "image", badge: "VR" },
      canReceiveInput: true, resizable: true,
    })

    context.commands.register({ id: "panorama.upload", source: "node:panorama", run: handlePanoramaUpload })
    context.commands.register({ id: "panorama.fullscreen", source: "node:panorama", run: handlePanoramaFullscreen })
    context.commands.register({ id: "panorama.reset", source: "node:panorama", run: handlePanoramaReset })
    context.commands.register({ id: "panorama.download", source: "node:panorama", run: handlePanoramaDownload })

    context.toolbars.register("node:panorama", {
      id: "panorama.upload", source: "node:panorama", commandId: "panorama.upload",
      position: "top", nodeTypes: ["panorama"], order: 10,
      customRender: markRaw(PanoramaUploadButton),
    })
    context.toolbars.register("node:panorama", {
      id: "panorama.fullscreen", source: "node:panorama", commandId: "panorama.fullscreen",
      position: "top", title: "全屏", icon: fullscreenSvg, nodeTypes: ["panorama"], order: 20,
      visible: (ctx) => !!(ctx.node?.data as any)?._editing,
    })
    context.toolbars.register("node:panorama", {
      id: "panorama.reset", source: "node:panorama", commandId: "panorama.reset",
      position: "top", title: "重置", icon: resetSvg, nodeTypes: ["panorama"], order: 30,
    })
    context.toolbars.register("node:panorama", {
      id: "panorama.download", source: "node:panorama", commandId: "panorama.download",
      position: "top", title: "下载", icon: downloadSvg, nodeTypes: ["panorama"], order: 40,
    })

    // 双击节点进入编辑模式
    const onDblClick = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.nodeId) return
      const node = context.actions.getNodes().find((n: Node) => n.id === detail.nodeId)
      if (!node || node.data?.nodeType !== "panorama") return
      if ((node.data as any)?._editing) return
      if (!(node.data as any)?.imageUrl && !(node.data as any)?.panoUrl) return
      context.actions.updateNode(detail.nodeId, { data: { ...(node.data as any), _editing: true } })
    }
    window.addEventListener("canvas:nodeDoubleClick", onDblClick)

    // 点击画布空白处 / 其他节点 → 退出编辑模式
    const onPaneClick = () => {
      const nodes = context.actions.getNodes()
      for (const n of nodes) {
        if ((n.data as any)?.nodeType === "panorama" && (n.data as any)?._editing) {
          context.actions.updateNode(n.id, { data: { ...(n.data as any), _editing: false } })
        }
      }
    }
    // 监听画布点击事件
    const onPaneMouseDown = (e: Event) => {
      const target = (e as MouseEvent).target as HTMLElement
      // 如果点击的是 panorama 节点内部，不退出编辑
      if (target?.closest(".vue-flow__node")) return
      onPaneClick()
    }
    window.addEventListener("mousedown", onPaneMouseDown, true)

    return {
      uninstall() {
        context.canvasNodes.unregister("panorama")
        context.toolbars.unregisterSource("node:panorama")
        context.commands.unregisterSource("node:panorama")
        window.removeEventListener("canvas:nodeDoubleClick", onDblClick)
        window.removeEventListener("mousedown", onPaneMouseDown, true)
      },
    }
  },
}
