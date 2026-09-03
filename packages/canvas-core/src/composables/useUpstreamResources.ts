import { computed, type ComputedRef } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import type { Edge } from '@vue-flow/core'

/** 上游资源的统一描述（图片 / 视频 / 文本等），供 @ 菜单引用 */
export interface UpstreamResource {
  /** 资源类型：image=有 url 的图片类；video=视频节点；text=文本节点内容 */
  kind: 'image' | 'video' | 'text'
  /** 显示名称（@ 时插入/反序列化的 key） */
  name: string
  /** 图片/视频类资源的 url；文本类为空字符串 */
  url: string
  /** 文本类资源的文本内容；图片/视频类为空字符串 */
  value: string
  /** 是否被连接进当前节点输入端口 */
  connected: true
}

/**
 * 获取当前节点输入端口（target handle）连接的所有上游节点资源。
 *
 * 与 `useUpstreamImages` 的区别：不只取图片，而是按上游 nodeType 分派，
 * 把「当前节点接受的所有类型输入」都纳入（例如图片节点可接受 image + text）。
 *
 * **响应式范围**: 仅追踪边拓扑变化（edges 数组增删），不追踪上游节点 data 字段变化。
 */
export function useUpstreamResources(nodeId: string | null): ComputedRef<UpstreamResource[]> {
  const { getEdges, findNode } = useVueFlow()

  return computed(() => {
    if (!nodeId) return []
    const edges = getEdges.value as Edge[]

    const resources: UpstreamResource[] = []
    const seen = new Set<string>() // 防止同一上游多次 @（同一边只算一次，去重）

    for (const edge of edges) {
      if (edge.target !== nodeId || (edge.targetHandle || 'target') !== 'target') continue
      if (seen.has(edge.source)) continue

      const sourceNode = findNode(edge.source)
      const data = sourceNode?.data as any
      if (!data) continue

      const nodeType = data.nodeType as string | undefined
      const label = (data.label as string) || ''

      // 图片类（image / panorama 等有 imageUrl 的节点）
      const url = (data.imageUrl as string) || (data.panoUrl as string) || ''
      if (url) {
        seen.add(edge.source)
        resources.push({
          kind: 'image',
          // 优先用节点标题 label（用户可重命名），未设置时才回退到文件名
          name: label || (data.imageName as string) || '素材',
          url,
          value: '',
          connected: true,
        })
        continue
      }

      // 视频类（video 节点：有 videoUrl）
      const videoUrl = (data.videoUrl as string) || ''
      if (videoUrl) {
        seen.add(edge.source)
        resources.push({
          kind: 'video',
          // 优先用节点标题 label（用户可重命名），未设置时才回退到文件名
          name: label || (data.videoName as string) || '视频',
          url: videoUrl,
          value: '',
          connected: true,
        })
        continue
      }

      // 文本类（text 节点）：只要节点类型是 text 就纳入（内容可暂为空，@ 时用名称占位）
      if (nodeType === 'text') {
        const text = (data.text as string) || ''
        seen.add(edge.source)
        resources.push({
          kind: 'text',
          name: (data.label as string) || '文本',
          url: '',
          value: text,
          connected: true,
        })
      }
    }

    return resources
  })
}
