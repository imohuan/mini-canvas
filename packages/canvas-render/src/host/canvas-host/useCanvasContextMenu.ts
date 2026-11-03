import type { EdgeMouseEvent, NodeMouseEvent } from '@vue-flow/core'
import { RenderEvents } from '../renderEvents'
import type { CanvasContextMenuPayload } from '../canvasHostTypes'
import type { CanvasHostHandle } from '../createMiniCanvasHost'

export function useCanvasContextMenu(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  clientToFlow: (x: number, y: number) => { x: number; y: number }
  emitContextMenu: (payload: CanvasContextMenuPayload) => void
}) {
  // 右键菜单：内部统一 preventDefault，把坐标透给父级弹业务菜单。
  function onNodeContextMenu(e: NodeMouseEvent): void {
    const ev = e.event as MouseEvent
    ev.preventDefault()
    opts.emitContextMenu({ kind: 'node', clientX: ev.clientX, clientY: ev.clientY, nodeId: e.node.id })
    // ctx 广播：插件(context-menu 等)经 ctx.on(RenderEvents.ContextMenuNode) 消费
    const h = opts.hostRef.value
    const node = h?.nodeStore.getNode(e.node.id)
    h?.ctx.emit(RenderEvents.ContextMenuNode, {
      clientX: ev.clientX,
      clientY: ev.clientY,
      flowPosition: opts.clientToFlow(ev.clientX, ev.clientY),
      nodeId: e.node.id,
      nodeType: node?.type,
    })
  }
  function onEdgeContextMenu(e: EdgeMouseEvent): void {
    const ev = e.event as MouseEvent
    ev.preventDefault()
    opts.emitContextMenu({ kind: 'edge', clientX: ev.clientX, clientY: ev.clientY, edgeId: e.edge.id })
    const h = opts.hostRef.value
    h?.ctx.emit(RenderEvents.ContextMenuEdge, {
      clientX: ev.clientX,
      clientY: ev.clientY,
      flowPosition: opts.clientToFlow(ev.clientX, ev.clientY),
      edgeId: e.edge.id,
    })
  }
  function onPaneContextMenu(e: MouseEvent): void {
    e.preventDefault()
    opts.emitContextMenu({ kind: 'pane', clientX: e.clientX, clientY: e.clientY })
    const h = opts.hostRef.value
    h?.ctx.emit(RenderEvents.ContextMenuPane, {
      clientX: e.clientX,
      clientY: e.clientY,
      flowPosition: opts.clientToFlow(e.clientX, e.clientY),
    })
  }

  return { onNodeContextMenu, onEdgeContextMenu, onPaneContextMenu }
}
