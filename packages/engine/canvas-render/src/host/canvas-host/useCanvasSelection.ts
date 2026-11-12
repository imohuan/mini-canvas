import { ref } from 'vue'
import type { EdgeMouseEvent, NodeMouseEvent } from '@vue-flow/core'
import { clickNode, clickEdge, clickPane } from '../selectionInteractions'
import { RenderEvents } from '../renderEvents'
import type { CanvasHostHandle } from '../createPlumeHost'

export function useCanvasSelection(opts: {
  hostRef: { value: CanvasHostHandle | undefined }
  syncFromStore: () => void
}) {
  const { hostRef } = opts

  // 选中集合注入给 CustomEdge：相连节点被选 → 边高亮流光。
  // 以 ReadonlySet 形状暴露（消费方只读）。内核 Selection 是单源：本 ref 只是它的派生投影——
  // 点击/清空/删除/撤销只写内核 selection，此处经订阅 onChange 整体替换新集合以触发响应式。
  const selectedIds = ref<ReadonlySet<string>>(new Set())
  const selectedEdgeSelRef = ref<ReadonlySet<string>>(new Set())
  const edgeSelection = { selectedNodeIds: selectedIds, selectedEdgeIds: selectedEdgeSelRef }

  /** 把内核 Selection 的 ids 投影成新的 ReadonlySet 引用（整体替换以触发 Vue 响应式） */
  function syncSelected(): void {
    const h = hostRef.value
    if (!h) return
    selectedIds.value = new Set(h.selection.ids)
    selectedEdgeSelRef.value = new Set(h.selection.edgeIds)
    // 重建渲染态节点与连线：内核选中(单击/框选/Ctrl+A)驱动 VueFlow 节点高亮一致，
    // 同时选中节点的连线要抬到 edgeSelected 档（连线的 z 在 syncFromStore 里随 selection 重算）
    opts.syncFromStore()
    h.ctx.emit(RenderEvents.SelectionChange, {
      nodeIds: [...h.selection.ids],
      edgeIds: [...h.selection.edgeIds],
    })
  }

  function onNodeClick(e: NodeMouseEvent): void {
    const h = hostRef.value
    if (!h) return
    clickNode(h.selection, e.node.id, { shiftKey: e.event.shiftKey })
    h.ctx.emit(RenderEvents.NodeClick, { nodeId: e.node.id, shiftKey: e.event.shiftKey })
  }

  function onEdgeClick(e: EdgeMouseEvent): void {
    const h = hostRef.value
    if (!h) return
    clickEdge(h.selection, e.edge.id, { shiftKey: e.event.shiftKey })
    h.ctx.emit(RenderEvents.EdgeClick, { edgeId: e.edge.id, shiftKey: e.event.shiftKey })
  }

  function onPaneClick(): void {
    const h = hostRef.value
    if (!h) return
    clickPane(h.selection)
    h.ctx.emit(RenderEvents.PaneClick, {})
  }

  return {
    edgeSelection,
    syncSelected,
    onNodeClick,
    onEdgeClick,
    onPaneClick,
  }
}
