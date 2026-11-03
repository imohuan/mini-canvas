import type { NodeDragEvent } from '@vue-flow/core'
import { beginNodeDrag, endNodeDrag } from '../../contracts/interactionContext'
import { dragSelectNode } from '../selectionInteractions'
import { RenderEvents, toDragPayload } from '../renderEvents'
import type { CanvasInteractionState } from '../../contracts/interactionContext'
import type { CanvasInteractionSettings } from '../../contracts/canvasInteractionSettings'
import type { CanvasHostHandle } from '../createMiniCanvasHost'
import type { CanvasSurfaceHandle } from './types'

export function useCanvasNodeDrag(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  surfaceRef: { value: CanvasSurfaceHandle | undefined }
  interaction: CanvasInteractionState
  interactionSettings: CanvasInteractionSettings
  primeDragProtection: (seed: Iterable<string>) => void
  clearDragProtection: () => void
}) {
  const { hostRef, surfaceRef, interaction } = opts
  /** 节点拖动逐帧（rAF 节流后 emit，避免 60Hz 刷屏） */
  let dragEmitRaf = 0

  function onNodeDragStart(e: NodeDragEvent): void {
    beginNodeDrag(interaction, e.node.id)
    // 一次收集本手势的保护名单（多选整组 + 分组子树），之后视口每帧只读缓存
    opts.primeDragProtection([...e.nodes.map((n) => n.id), e.node.id])
    // 「拖拽选中」：拖动未选中节点时顺手选中它（写进内核 selection 单源；VueFlow 内部
    // select-on-drag 不回写内核，会被渲染投影覆盖 —— 必须在这里显式写）。
    const h0 = hostRef.value
    if (h0) {
      dragSelectNode(h0.selection, e.node.id, {
        enabled: opts.interactionSettings.selectNodesOnDrag,
        selectable: opts.interactionSettings.elementsSelectable,
      })
    }
    const payload = toDragPayload(e)
    if (payload) hostRef.value?.ctx.emit(RenderEvents.NodeDragStart, payload)
  }

  function onNodeDragStop(e: NodeDragEvent): void {
    endNodeDrag(interaction)
    // 松手后位置已经落盘：立即清缓存，让视口外的节点恢复常规裁剪
    opts.clearDragProtection()
    const h = hostRef.value
    if (!h) return
    // VueFlow 拖动多选时已把位移应用到全部选中节点：这里把它们的最终位置一起写回内核 store，
    // 避免只写主节点导致其它被拖节点弹回原位。
    const surface = surfaceRef.value
    const moved = surface?.getSelectedNodePositions?.() ?? []
    if (moved.length > 0 || e.node.position) {
      const patches = moved.length > 0
        ? moved.map((p) => ({ id: p.id, patch: { position: { x: p.x, y: p.y } } }))
        : [{ id: e.node.id, patch: { position: { x: e.node.position.x, y: e.node.position.y } } }]
      // 拖动结束统一走 graph：历史 + 提交落盘由唯一写入口负责；无位移时快照无差异不入历史。
      h.graph.updateNodes(patches)
    }
    // 逐个成员广播 drag-end：成员归属插件（plugin-group）按各自新位置重算 join/leave。
    // 曾经只广播主节点 —— 多选整组拖动时其它成员的脱离/归组没人处理
    //（用户实测："多选拖拽只计算了单个节点的脱离，第一个节点依然跟随它的父节点移动"）。
    const movedIds =
      moved.length > 0
        ? moved
        : [{ id: e.node.id, x: e.node.position.x, y: e.node.position.y }]
    for (const m of movedIds) {
      // payload.position 一律报 **flow 绝对坐标**（与 NodeDragStart/NodeDrag 同契约，见 renderEvents.toDragPayload）。
      // 上面写回 store 用的是 VueFlow 的 position —— 分组子节点那是**相对父**的（store 语义就是相对，必须这么写）；
      // 但事件契约是绝对坐标（消费方按绝对理解：多选包围盒、对齐吸附都用 nodeLayout 的绝对矩形）。
      // 直接广播 m.x/m.y 会让子节点场景下消费方拿到相对值 —— 多选框据此算包围盒时高度会炸（实测 240 → 600）。
      h.ctx.emit(RenderEvents.NodeDragEnd, { nodeId: m.id, position: h.view.absolutePosition(m.id) })
    }
  }

  function onNodeDrag(e: NodeDragEvent): void {
    if (dragEmitRaf) return
    dragEmitRaf = requestAnimationFrame(() => {
      dragEmitRaf = 0
      const h = hostRef.value
      const payload = toDragPayload(e)
      if (h && payload) h.ctx.emit(RenderEvents.NodeDrag, payload)
    })
  }

  function dispose(): void {
    if (dragEmitRaf) cancelAnimationFrame(dragEmitRaf)
  }

  return { onNodeDragStart, onNodeDragStop, onNodeDrag, dispose }
}
