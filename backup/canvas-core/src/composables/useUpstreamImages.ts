import { computed, type ComputedRef } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { Edge } from '@vue-flow/core'

export interface UpstreamImageData {
  url: string
  name: string
  width: number
  height: number
}

/**
 * 获取当前节点所有上游 image 节点的原始数据。
 * 通过 filter target edge → findNode source → extract imageUrl/name/width/height。
 *
 * **响应式范围**: 仅追踪边拓扑变化（edges 数组增删），不追踪上游节点 data 字段变化。
 * 如果上游节点的 imageUrl 在边已存在之后才异步加载完成，此 computed 不会自动重新计算。
 */
export function useUpstreamImages(nodeId: string | null): ComputedRef<UpstreamImageData[]> {
  const { getEdges, findNode } = useVueFlow()

  return computed(() => {
    if (!nodeId) return []
    const edges = getEdges.value as Edge[]
    return edges
      .filter(e => e.target === nodeId && e.targetHandle === 'target')
      .map(e => {
        const sourceNode = findNode(e.source)
        const data = sourceNode?.data as any
        const url = (data?.imageUrl as string) || ''
        const name = (data?.imageName as string) || (data?.label as string) || ''
        const width = (data?.imageWidth as number) || 0
        const height = (data?.imageHeight as number) || 0
        if (!url) return null
        return { url, name, width, height }
      })
      .filter((x): x is UpstreamImageData => x !== null)
  })
}
