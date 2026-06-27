import { markRaw } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { Position } from '@vue-flow/core'
import { ImageCompareNode } from './index'
import type { CanvasPlugin, PluginContext } from '../../plugins/types'
import type { CommandContext } from '../../registry/types'

const menuIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/><line x1="9" y1="12" x2="15" y2="12" stroke-width="1"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`
const titleIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="8" height="18" rx="1"/><rect x="13" y="3" width="8" height="18" rx="1"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>`

export const ImageCompareNodePlugin: CanvasPlugin = {
  name: 'node:image-compare',
  version: '1.0.0',

  install(context: PluginContext) {
    context.canvasNodes.register({
      type: 'image-compare',
      node: markRaw(ImageCompareNode),
      label: '图片对比',
      defaultSize: { cardWidth: 500, cardHeight: 350 },
      menuItem: {
        label: '图片对比',
        description: '创建图片对比节点，连接2个图片节点并排对比',
        icon: menuIconSvg,
        badge: 'Compare',
      },
      canReceiveInput: true,
      resizable: false,
      titleIcon: titleIconSvg,
    })

    /** 限制最多 2 条输入连接（FIFO）：第 3 条连接时删除最早那条 */
    const offConnect = context.on('connect', (connection: {
      source: string
      target: string
      sourceHandle: string | null
      targetHandle: string | null
    }) => {
      if (connection.targetHandle !== 'target') return

      const targetNode = context.actions.getNodes().find(
        (n: Node) => n.id === connection.target
      )
      if ((targetNode?.data as any)?.nodeType !== 'image-compare') return

      const allEdges = context.actions.getEdges()
      const inputEdges = allEdges.filter(
        e => e.target === connection.target && e.targetHandle === 'target'
      )

      // 只有超过 2 条时清理
      if (inputEdges.length <= 2) return

      // 找到刚创建的新边
      const newEdge = inputEdges.find(
        e => e.source === connection.source
          && e.target === connection.target
          && e.sourceHandle === connection.sourceHandle
          && e.targetHandle === connection.targetHandle
      )
      if (!newEdge) return

      // 旧边 = 所有输入边去掉新边
      const oldEdges = inputEdges.filter(e => e.id !== newEdge.id)
      if (oldEdges.length === 0) return

      // 保留 2 条：newEdge + 旧边中最新那条（数组最后一条）
      // 删除剩余最早的
      const toRemove = oldEdges.slice(0, oldEdges.length - 1)
      if (toRemove.length > 0) {
        context.actions.removeEdges(toRemove.map(e => e.id))
      }
    })

    return {
      uninstall() {
        context.canvasNodes.unregister('image-compare')
        offConnect()
      },
    }
  },
}
