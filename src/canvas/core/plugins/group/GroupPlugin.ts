import type { CanvasPlugin, PluginContext } from '../types'
import GroupNode from './GroupNode.vue'

// ============================================================================
// Constants
// ============================================================================

const GROUP_PADDING = 30
const GROUP_PADDING_TOP = 10
const DRAG_THRESHOLD = 3
const OVERLAP_RATIO = 0
const DEFAULT_WIDTH = 200
const DEFAULT_HEIGHT = 100

// ============================================================================
// Types
// ============================================================================

export interface GroupBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface GroupAPI {
  createGroup(nodeIds: string[]): string | null
  ungroup(groupId: string): void
  getGroupNodeIds(): string[]
  /** 根据组内子节点的绝对坐标重新计算 GroupNode 的 bounds 并更新 */
  recalculateBounds(groupId: string): GroupBounds | null
}

// ============================================================================
// Plugin
// ============================================================================

export const GroupPlugin: CanvasPlugin<Record<string, unknown>, GroupAPI> = {
  name: 'group',
  version: '0.1.0',
  dependencies: ['multi-select'],

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger

    // 1. Register the group node type
    context.registerNodeType('group', GroupNode)

    // ====================================================================
    // Helpers
    // ====================================================================

    function isNodeInGroup(
      nodeX: number, nodeY: number, nodeW: number, nodeH: number,
      groupX: number, groupY: number, groupW: number, groupH: number,
    ): boolean {
      const overlapLeft = Math.max(nodeX, groupX)
      const overlapTop = Math.max(nodeY, groupY)
      const overlapRight = Math.min(nodeX + nodeW, groupX + groupW)
      const overlapBottom = Math.min(nodeY + nodeH, groupY + groupH)
      if (overlapLeft >= overlapRight || overlapTop >= overlapBottom) return false
      const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop)
      const nodeArea = nodeW * nodeH
      return overlapArea / nodeArea > OVERLAP_RATIO
    }

    /** 获取节点的绝对坐标（flow 坐标系）。 */
    function getComputedPos(node: any): { x: number; y: number } {
      if (node.parentNode && node.computedPosition && node.computedPosition.x !== undefined) {
        return node.computedPosition
      }
      return node.position
    }

    function getDimensions(node: any): { w: number; h: number } {
      return {
        w: node.dimensions?.width ?? (node.style?.width ? parseInt(node.style.width) : DEFAULT_WIDTH),
        h: node.dimensions?.height ?? (node.style?.height ? parseInt(node.style.height) : DEFAULT_HEIGHT),
      }
    }

    function buildNodeMap(nodes: any[]): Map<string, any> {
      const map = new Map<string, any>()
      for (const n of nodes) map.set(n.id, n)
      return map
    }

    // ====================================================================
    // Group / Ungroup core logic
    // ====================================================================

    function createGroup(nodeIds: string[]): string | null {
      const allNodes = context.actions.getNodes()

      const eligible = allNodes.filter(
        n => nodeIds.includes(n.id) && !n.parentNode && n.type !== 'group',
      )
      if (eligible.length < 2) {
        if (eligible.length < nodeIds.length) {
          logger.warn(`${nodeIds.length - eligible.length} nodes skipped (already grouped or group nodes)`)
        }
        return null
      }

      const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

      for (const n of eligible) {
        const dim = getDimensions(n)
        positions.set(n.id, { x: n.position.x, y: n.position.y, w: dim.w, h: dim.h })
        minX = Math.min(minX, n.position.x)
        minY = Math.min(minY, n.position.y)
        maxX = Math.max(maxX, n.position.x + dim.w)
        maxY = Math.max(maxY, n.position.y + dim.h)
      }

      const groupW = maxX - minX + GROUP_PADDING * 2
      const groupH = maxY - minY + GROUP_PADDING * 2 + GROUP_PADDING_TOP
      const groupX = minX - GROUP_PADDING
      const groupY = minY - GROUP_PADDING - GROUP_PADDING_TOP

      const groupId = `group-${Date.now()}`

      logger.info('createGroup bbox:', {
        groupId,
        bbox: { x: groupX, y: groupY, w: groupW, h: groupH },
        children: eligible.map(n => ({
          id: n.id,
          abs: positions.get(n.id),
          rel: { x: (positions.get(n.id)!.x - groupX), y: (positions.get(n.id)!.y - groupY) },
        })),
      })

      context.actions.removeSelectedElements()
      context.selection.clearSelection()

      context.actions.addNodes([{
        id: groupId,
        type: 'group',
        // 不再需要 template 字段，nodeTypes 由 Canvas.vue 静态提供
        position: { x: groupX, y: groupY },
        style: { width: `${Math.max(groupW, 200)}px`, height: `${Math.max(groupH, 150)}px` },
        data: { label: '分组' },
        zIndex: 0,
        selectable: true,
        draggable: true,
      }])

      const children = eligible.map(n => ({
        id: n.id,
        relX: positions.get(n.id)!.x - groupX,
        relY: positions.get(n.id)!.y - groupY,
      }))

      function reparentChildren() {
        const allNodes = context.actions.getNodes()
        const groupExists = allNodes.some(n => n.id === groupId)
        if (!groupExists) {
          logger.debug(`Group ${groupId} not yet in node store, retrying reparent...`)
          requestAnimationFrame(reparentChildren)
          return
        }

        for (const c of children) {
          context.actions.updateNode(c.id, {
            position: { x: c.relX, y: c.relY },
            parentNode: groupId,
          })
        }

        context.actions.addSelectedNodes(allNodes.filter(n => n.id === groupId))
        logger.info(`Group created: ${groupId} with ${eligible.length} nodes`)
      }

      requestAnimationFrame(reparentChildren)
      return groupId
    }

    function ungroup(groupId: string): void {
      const allNodes = context.actions.getNodes()
      const groupNode = allNodes.find(n => n.id === groupId)
      const childNodes = allNodes.filter(n => n.parentNode === groupId)

      if (!groupNode && childNodes.length === 0) return

      for (const n of childNodes) {
        const pos = getComputedPos(n)
        context.actions.updateNode(n.id, {
          position: { x: pos.x, y: pos.y },
          parentNode: undefined,
          extent: undefined,
        })
      }

      if (groupNode) {
        context.actions.removeNodes([groupId])
      }
      logger.info(`Group dissolved: ${groupId}, freed ${childNodes.length} nodes`)
    }

    /**
     * 仅 un-parent 子节点，不调 removeNodes — 用于外部删除群组场景
     * （群组已被 VueFlow 移除，再调 removeNodes 会触发 nodes-change 递归）
     */
    function unparentChildren(groupId: string): void {
      const allNodes = context.actions.getNodes()
      const childNodes = allNodes.filter(n => n.parentNode === groupId)
      if (childNodes.length === 0) return

      for (const n of childNodes) {
        const pos = getComputedPos(n)
        context.actions.updateNode(n.id, {
          position: { x: pos.x, y: pos.y },
          parentNode: undefined,
          extent: undefined,
        })
      }
      logger.debug(`External group removal: ${groupId}, un-parented ${childNodes.length} nodes`)
    }

    // ====================================================================
    // Auto-group/ungroup on drag stop
    // ====================================================================

    let dragStartPos: { x: number; y: number } | null = null

    function getPaneEl(): HTMLElement | null {
      return document.querySelector('.vue-flow__pane')
    }

    function onPointerDown(e: PointerEvent) {
      if (e.button !== 0) return
      dragStartPos = { x: e.clientX, y: e.clientY }
    }

    function onPointerUp(e: PointerEvent) {
      if (!dragStartPos) return
      const dx = e.clientX - dragStartPos.x
      const dy = e.clientY - dragStartPos.y
      dragStartPos = null
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return

      setTimeout(() => {
        try {
          runOverlapCheck()
        } catch (err) {
          logger.error('Auto-group/ungroup overlap check failed:', err)
        }
      }, 0)
    }

    function runOverlapCheck() {
      const allNodes = context.actions.getNodes()
      const nodeMap = buildNodeMap(allNodes)
      const groupNodes = allNodes.filter(n => n.type === 'group')
      if (groupNodes.length === 0) return

      for (const node of allNodes) {
        if (node.type === 'group') continue

        const pos = getComputedPos(node)
        const dim = getDimensions(node)

        if (node.parentNode) {
          const parent = nodeMap.get(node.parentNode)
          if (parent) {
            const pPos = getComputedPos(parent)
            const pDim = getDimensions(parent)
            if (!isNodeInGroup(pos.x, pos.y, dim.w, dim.h, pPos.x, pPos.y, pDim.w, pDim.h)) {
              context.actions.updateNode(node.id, {
                position: { x: pos.x, y: pos.y },
                parentNode: undefined,
                extent: undefined,
              })
              logger.debug(`Node ${node.id} left group ${parent.id}`)
            }
          }
          continue
        }

        for (const group of groupNodes) {
          const gPos = getComputedPos(group)
          const gDim = getDimensions(group)
          if (isNodeInGroup(pos.x, pos.y, dim.w, dim.h, gPos.x, gPos.y, gDim.w, gDim.h)) {
            context.actions.updateNode(node.id, {
              position: { x: pos.x - gPos.x, y: pos.y - gPos.y },
              parentNode: group.id,
            })
            logger.debug(`Node ${node.id} joined group ${group.id}`)
            break
          }
        }
      }
    }

    // Scope to pane
    const pane = getPaneEl()
    const pointerTarget = pane ?? document
    pointerTarget.addEventListener('pointerdown', onPointerDown as EventListener)
    document.addEventListener('pointerup', onPointerUp as EventListener)

    // ====================================================================
    // Ungroup button from GroupNode (via window CustomEvent)
    // ====================================================================

    function onGroupUngroupEvent(e: Event) {
      const detail = (e as CustomEvent).detail as { groupId?: string }
      console.log('[GroupPlugin][event] canvas:group:ungroup received:', detail)
      if (detail?.groupId) {
        ungroup(detail.groupId)
      } else {
        console.warn('[GroupPlugin][event] missing groupId:', detail)
      }
    }

    window.addEventListener('canvas:group:ungroup', onGroupUngroupEvent)
    console.log('[GroupPlugin][event] listener registered: canvas:group:ungroup')

    // ====================================================================
    // External group removal (Delete key, etc.) — nodesChange handler
    // 群组已被 VueFlow 删除，只需 un-parent 子节点，不能调 removeNodes
    // ====================================================================

    function onExternalNodesChange(changes: any[]) {
      const removeChanges = changes.filter((c: any) => c.type === 'remove')
      if (removeChanges.length === 0) return

      const allNodes = context.actions.getNodes()
      for (const change of removeChanges) {
        const node = allNodes.find(n => n.id === (change as any).id)
        if (node && node.type === 'group') {
          unparentChildren(node.id)
        }
      }
    }

    context.on('nodesChange', onExternalNodesChange)

    // ====================================================================
    // Keyboard shortcuts
    // ====================================================================

    context.registerShortcut('ctrl+g', () => {
      const selectedIds = context.selection.getSelectedNodeIds()
      const allNodes = context.actions.getNodes()
      const nonGroupIds = allNodes
        .filter(n => selectedIds.has(n.id) && n.type !== 'group')
        .map(n => n.id)
      if (nonGroupIds.length >= 2) {
        createGroup(nonGroupIds)
      }
      return true
    }, '创建分组')

    context.registerShortcut('ctrl+shift+g', () => {
      const selectedIds = context.selection.getSelectedNodeIds()
      const allNodes = context.actions.getNodes()
      for (const id of selectedIds) {
        const node = allNodes.find(n => n.id === id)
        if (node && node.type === 'group') {
          ungroup(id)
        }
      }
    }, '解散分组')

    // ====================================================================
    // recalculateBounds: 根据组内子节点重新计算 GroupNode bounds
    // 供 AutoLayoutPlugin 调用
    // ====================================================================

    function recalculateBounds(groupId: string): GroupBounds | null {
      const allNodes = context.actions.getNodes()
      const groupNode = allNodes.find(n => n.id === groupId && n.type === 'group')
      if (!groupNode) return null

      const childNodes = allNodes.filter(n => n.parentNode === groupId)

      if (childNodes.length === 0) {
        // 空组保持当前尺寸
        const gDim = getDimensions(groupNode)
        return {
          x: groupNode.position.x,
          y: groupNode.position.y,
          w: gDim.w,
          h: gDim.h,
        }
      }

      // 用 computedPosition 获取子节点的绝对坐标
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const n of childNodes) {
        const pos = getComputedPos(n)
        const dim = getDimensions(n)
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + dim.w)
        maxY = Math.max(maxY, pos.y + dim.h)
      }

      const newW = Math.max(maxX - minX + GROUP_PADDING * 2, 200)
      const newH = Math.max(maxY - minY + GROUP_PADDING * 2 + GROUP_PADDING_TOP, 150)
      const newX = minX - GROUP_PADDING
      const newY = minY - GROUP_PADDING - GROUP_PADDING_TOP

      // 更新 GroupNode 的位置和尺寸
      context.actions.updateNode(groupId, {
        position: { x: newX, y: newY },
        style: { width: `${newW}px`, height: `${newH}px` },
      })

      // 更新子节点的相对位置
      for (const n of childNodes) {
        const pos = getComputedPos(n)
        context.actions.updateNode(n.id, {
          position: { x: pos.x - newX, y: pos.y - newY },
          parentNode: groupId,
        })
      }

      logger.debug(`Group ${groupId} bounds recalculated: (${newX},${newY}) ${newW}x${newH}`)
      return { x: newX, y: newY, w: newW, h: newH }
    }

    // ====================================================================
    // API
    // ====================================================================

    function getGroupNodeIds(): string[] {
      return context.actions.getNodes().filter(n => n.type === 'group').map(n => n.id)
    }

    const api: GroupAPI = { createGroup, ungroup, getGroupNodeIds, recalculateBounds }

    logger.info('GroupPlugin v0.1.0 ready (Ctrl+G group, Ctrl+Shift+G ungroup, auto-drag in/out)')

    return {
      api,
      uninstall() {
        context.off('nodesChange', onExternalNodesChange)
        pointerTarget.removeEventListener('pointerdown', onPointerDown as EventListener)
        document.removeEventListener('pointerup', onPointerUp as EventListener)
        window.removeEventListener('canvas:group:ungroup', onGroupUngroupEvent)
        try { context.unregisterShortcut('ctrl+g') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('ctrl+shift+g') } catch (_e) { /* ignore */ }
      },
    }
  },
}
