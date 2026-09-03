import { nextTick } from 'vue'
import { Position } from '@vue-flow/core'
import type { Edge, Node } from '@vue-flow/core'
import type { StorageAPI } from '../plugins/storage/StoragePlugin'

export function createDefaultCanvasData(edgeData: Record<string, unknown>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [
    { id: '1', type: 'custom', position: { x: 200, y: 260 }, data: { label: '输入图像', nodeType: 'image' }, sourcePosition: Position.Right },
    { id: '2', type: 'custom', position: { x: 700, y: 260 }, data: { label: '生成图像', nodeType: 'image' }, sourcePosition: Position.Right, targetPosition: Position.Left },
    { id: '3', type: 'custom', position: { x: 1200, y: 260 }, data: { label: '生成图像', nodeType: 'image' }, sourcePosition: Position.Right, targetPosition: Position.Left },
  ]

  const edges: Edge[] = [
    { id: 'e1-2', type: 'custom', source: '1', target: '2', sourceHandle: 'source', targetHandle: 'target', data: edgeData },
  ]

  return { nodes, edges }
}

export function useCanvasBootstrap(vueFlowInstance: any, getStorageApiFn: () => StorageAPI | null, makeEdgeData: () => Record<string, unknown>) {
  async function loadInitialCanvas() {
    const storage = getStorageApiFn()
    const currentProjectId = storage?.currentProjectId

    if (storage && currentProjectId) {
      const data = await storage.loadCanvas(currentProjectId)
      if (data.nodes.length > 0 || data.edges.length > 0) {
        vueFlowInstance.fromObject({ nodes: data.nodes, edges: data.edges })
        await nextTick()
        // fitView 把视口适配到已保存节点，避免节点位于视口外导致"刷新后空白、需滚动/缩放才显示"
        try {
          await vueFlowInstance.fitView({ padding: 0.2, duration: 0 })
        } catch {
          // fitView 在节点初始化未完成时可能失败，忽略即可
        }
        return
      }
    }

    const fallback = createDefaultCanvasData(makeEdgeData())
    vueFlowInstance.addNodes(fallback.nodes)
    vueFlowInstance.addEdges(fallback.edges)
    await nextTick()
  }

  return { loadInitialCanvas }
}