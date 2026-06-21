import { markRaw } from "vue"
import type { Node, Edge } from "@vue-flow/core"
import { Position } from "@vue-flow/core"
import { PanoramaNode } from "./index"
import PanoramaUploadButton from "./PanoramaUploadButton.vue"
import type { CanvasPlugin, PluginContext } from "../../plugins/types"
import type { CommandContext } from "../../registry/types"

const fullscreenSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
const resetSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>`
const downloadSvg = `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`

const MAX_PREVIEW_WIDTH = 420
const MAX_PREVIEW_HEIGHT = 300

function fitCardSize(width: number, height: number) {
  const ratio = Math.min(MAX_PREVIEW_WIDTH / width, MAX_PREVIEW_HEIGHT / height, 1)
  return { cardWidth: Math.max(120, Math.round(width * ratio)), cardHeight: Math.max(80, Math.round(height * ratio)) }
}

function readImageDims(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url) }
    image.onerror = () => { resolve(null); URL.revokeObjectURL(url) }
    image.src = url
  })
}

async function handlePanoramaUpload(ctx: CommandContext, args?: unknown) {
  const file = (args as { file?: File })?.file
  if (!file) return
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const panoramaNodeId = ctx.node?.id
  if (!vf || !panoramaNodeId) return

  const imageUrl = URL.createObjectURL(file)
  const dims = await readImageDims(file)
  const nextSize = dims ? fitCardSize(dims.width, dims.height) : { cardWidth: 360, cardHeight: 270 }

  // 获取 panorama 节点位置
  const panoNode = (vf.getNodes.value as Node[]).find((n: Node) => n.id === panoramaNodeId)
  const panoPos = panoNode?.position ?? { x: 0, y: 0 }
  const panoCardHeight = (panoNode?.data as any)?.cardHeight ?? 400

  // 计算 image 节点位置（panorama 左侧 80px 间距，垂直居中）
  const imageNodeId = `image-${panoramaNodeId}-${Date.now()}`
  const imagePos = {
    x: panoPos.x - nextSize.cardWidth - 80,
    y: panoPos.y + (panoCardHeight - nextSize.cardHeight) / 2,
  }

  // 创建 image 节点
  vf.addNodes([{
    id: imageNodeId,
    type: "custom",
    position: imagePos,
    data: {
      label: file.name,
      nodeType: "image",
      imageUrl,
      imageName: file.name,
      imageType: file.type,
      imageWidth: dims?.width,
      imageHeight: dims?.height,
      cardWidth: nextSize.cardWidth,
      cardHeight: nextSize.cardHeight,
      resizable: true,
    },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
  } as Node])

  // 创建边：image → panorama
  await new Promise(r => setTimeout(r, 0)) // nextTick
  vf.addEdges([{
    id: `e-${imageNodeId}-${panoramaNodeId}-${Date.now()}`,
    type: "custom",
    source: imageNodeId,
    target: panoramaNodeId,
    sourceHandle: "source",
    targetHandle: "target",
  } as Edge])

  // 持久化
  const assetManager = runtime.getPluginAPI?.("storage")?.assets
  if (assetManager) {
    try { await assetManager.saveAsset(file, file.name, file.type) }
    catch (err) { ctx.logger.error("保存全景图资产失败:", err) }
  }
}

function handlePanoramaFullscreen(ctx: CommandContext) {
  const nodeId = ctx.node?.id
  if (!nodeId) return
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  if (vf) {
    const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === nodeId)
    vf.updateNode(nodeId, {
      data: { ...(node?.data ?? {}), _editing: true },
    })
  }
  window.dispatchEvent(new CustomEvent("panorama:fullscreen", { detail: { nodeId } }))
}

function handlePanoramaReset(ctx: CommandContext) {
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  const panoramaNodeId = ctx.node?.id
  if (!vf || !panoramaNodeId) return

  // 查找所有连接到输入端口的上游 image 节点
  const edges = (vf.getEdges.value as Edge[]).filter(
    (e) => e.target === panoramaNodeId && e.targetHandle === "target"
  )

  // 删除边和关联的 image 节点
  if (edges.length > 0) {
    vf.removeEdges(edges.map(e => e.id))
    vf.removeNodes(edges.map(e => e.source))
  }

  // 重置 panorama 节点状态
  const node = (vf.getNodes.value as Node[]).find((n: Node) => n.id === panoramaNodeId)
  vf.updateNode(panoramaNodeId, {
    data: { ...(node?.data ?? {}), imageUrl: undefined, panoUrl: undefined, label: "360全景", _editing: false },
  })
}

function handlePanoramaDownload(ctx: CommandContext) {
  const node = ctx.node
  if (!node) return

  // 优先从上游连接的 image 节点获取 imageUrl
  const runtime = ctx.runtime as any
  const vf = runtime?.vueFlowInstance
  let url = ""
  let name = "panorama.jpg"

  if (vf) {
    const edges = (vf.getEdges.value as Edge[]).filter(
      (e) => e.target === node.id && e.targetHandle === "target"
    )
    if (edges.length > 0) {
      const sourceNode = (vf.getNodes.value as Node[]).find((n: Node) => n.id === edges[0].source)
      url = (sourceNode?.data as any)?.imageUrl as string || ""
      name = (sourceNode?.data as any)?.imageName as string || name
    }
  }

  // 兜底：自身 data
  if (!url) {
    url = ((node.data as any)?.imageUrl as string) || ((node.data as any)?.panoUrl as string)
  }

  if (!url) return
  const a = document.createElement("a")
  a.href = url
  a.download = name
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
    })
    context.toolbars.register("node:panorama", {
      id: "panorama.reset", source: "node:panorama", commandId: "panorama.reset",
      position: "top", title: "重置", icon: resetSvg, nodeTypes: ["panorama"], order: 30,
    })
    context.toolbars.register("node:panorama", {
      id: "panorama.download", source: "node:panorama", commandId: "panorama.download",
      position: "top", title: "下载", icon: downloadSvg, nodeTypes: ["panorama"], order: 40,
    })

    const offNodeDblClick = context.on("nodeDoubleClick", (payload: { nodeId: string; nodeType: string }) => {
      if (payload.nodeType !== "panorama") return
      const node = context.actions.getNodes().find((n: Node) => n.id === payload.nodeId)
      if (!node) return
      if ((node.data as any)?._editing) return
      // 检查是否有上游连接（输入端口是否有 edge）
      const hasInputConnection = context.actions.getEdges().some(
        (e) => e.target === payload.nodeId && e.targetHandle === "target"
      )
      if (!hasInputConnection) return
      context.actions.updateNode(payload.nodeId, { data: { ...(node.data as any), _editing: true } })
    })

    const offPaneClick = context.on("paneClick", () => {
      const nodes = context.actions.getNodes()
      for (const n of nodes) {
        if ((n.data as any)?.nodeType === "panorama" && (n.data as any)?._editing) {
          context.actions.updateNode(n.id, { data: { ...(n.data as any), _editing: false } })
        }
      }
    })

    return {
      uninstall() {
        context.canvasNodes.unregister("panorama")
        context.toolbars.unregisterSource("node:panorama")
        context.commands.unregisterSource("node:panorama")
        offNodeDblClick()
        offPaneClick()
      },
    }
  },
}
