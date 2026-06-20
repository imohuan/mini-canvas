import type { CanvasPlugin, PluginContext } from '../types'

/**
 * MultiSelectPlugin — 多选/框选/加减选插件 (v0.7.0)
 *
 * @description
 * 核心策略：保留 elementsSelectable=true，只关闭 VueFlow 原生框选
 *
 * - Canvas.vue 通过 selectionKeyCode=null 禁用 VueFlow 原生框选
 * - elementsSelectable=true → 保留 VueFlow 的节点/边选中事件链
 * - 插件接管：Shift+拖拽框选、Ctrl+A 全选、Escape 清除、选中事件通知
 * - VueFlow 原生保留：节点单击选中、Shift+单击加减选、单击空白取消选中、nodes-change/edges-change
 *
 * 坐标系统说明：
 * - renderer-relative = clientX - rendererBounds.left（VueFlow 的标准输入格式）
 * - flow 坐标 = (renderer-relative - pan) / zoom（通过 project 转换）
 * - 节点 position 在 flow 坐标系中
 *
 * @event selection:change → { nodeIds: string[], edgeIds: string[], count: number }
 */

// ============================================================================
// 常量
// ============================================================================

/** 框选选区的 CSS 样式 — position:fixed 直接用屏幕坐标，不受 viewport transform 影响 */
const SELECTION_BOX_CSS = `
  position: fixed;
  border: 1.5px dashed #3b82f6;
  background: rgba(59, 130, 246, 0.06);
  pointer-events: none;
  z-index: 9999;
  border-radius: 2px;
`

export interface MultiSelectAPI {
  readonly selectedNodeIds: Set<string>
  readonly selectedNodes: any[]
  selectAll(nodes: any[]): void
  clearSelection(): void
}

// ============================================================================
// Plugin
// ============================================================================

export const MultiSelectPlugin: CanvasPlugin<Record<string, unknown>, MultiSelectAPI> = {
  name: 'multi-select',
  version: '0.7.0',

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger

    // ====== 框选状态 ======
    let selectionBox: HTMLDivElement | null = null
    let startScreenX = 0  // 屏幕坐标
    let startScreenY = 0
    let isBoxSelecting = false
    let boxDragDistance = 0
    const DRAG_THRESHOLD = 4
    let prevBoxNodeIds: string[] = []
    let suppressNextPaneClick = false

    // ====== DOM helpers ======

    function getPaneEl(): HTMLElement | null {
      return document.querySelector('.vue-flow__pane')
    }

    /**
     * 将屏幕坐标 (clientX, clientY) 转换为 flow 坐标
     * 复刻 VueFlow 的 project/logic：
     *   renderer-relative = clientX - rendererBounds.left
     *   flow = (renderer-relative - viewport.x) / viewport.zoom
     */
    function screenToFlow(clientX: number, clientY: number): { x: number; y: number } {
      return context.viewport.screenToFlowCoordinate({ x: clientX, y: clientY })
    }

    // ====== 节点 selectable 打标 ======

    function patchNodeSelectable(nodeId: string) {
      try {
        context.actions.updateNode(nodeId, { selectable: true } as any)
      } catch (_e) { /* ignore */ }
    }

    function patchAllNodesSelectable() {
      const nodes = context.actions.getNodes()
      logger.debug(`节点打标: 共 ${nodes.length} 个节点`)
      for (const n of nodes) {
        if ((n as any).selectable === undefined) {
          patchNodeSelectable(n.id)
          logger.debug(`节点 ${n.id}: selectable → true`)
        }
      }
    }

    // ====== 选中状态操作 ======

    function emitSelectionChange() {
      const nodeIds = [...context.selection.getSelectedNodeIds()]
      const edgeIds = [...context.selection.getSelectedEdgeIds()]
      const payload = { nodeIds, edgeIds, count: nodeIds.length }
      context.emit('selection:change', payload)
      logger.debug('选中变化:', { count: nodeIds.length, ids: nodeIds })
    }

    function clearSelectionInternal() {
      context.actions.removeSelectedElements()
      context.selection.clearSelection()
      emitSelectionChange()
    }

    // ====== 节点碰撞检测 ======

    /**
     * 检查节点是否在框选矩形内（flow 坐标系）
     * 使用局部相交模式：矩形重叠面积 > 0 即算选中
     */
    function isNodeInRect(node: any, rect: { x: number; y: number; w: number; h: number }): boolean {
      const nodeW = node.dimensions?.width ?? 256
      const nodeH = node.dimensions?.height ?? 256
      // 使用绝对坐标（flow 坐标系）：group 内子节点的 position 是相对父 group 的，
      // computedPosition 才是 VueFlow 自动计算的绝对坐标
      const nodeX = node.computedPosition?.x ?? node.position.x
      const nodeY = node.computedPosition?.y ?? node.position.y

      return !(
        nodeX + nodeW <= rect.x ||
        nodeX >= rect.x + rect.w ||
        nodeY + nodeH <= rect.y ||
        nodeY >= rect.y + rect.h
      )
    }

    // ====== 框选实现 ======

    function createSelectionBox() {
      if (selectionBox) return
      selectionBox = document.createElement('div')
      selectionBox.style.cssText = SELECTION_BOX_CSS
      document.body.appendChild(selectionBox)
    }

    function removeSelectionBox() {
      if (selectionBox?.parentNode) {
        selectionBox.parentNode.removeChild(selectionBox)
      }
      selectionBox = null
    }

    /** 更新选择框视觉 — 直接用屏幕坐标 */
    function updateSelectionBoxVisual(x1: number, y1: number, x2: number, y2: number) {
      if (!selectionBox) return
      const left = Math.min(x1, x2)
      const top = Math.min(y1, y2)
      const width = Math.abs(x2 - x1)
      const height = Math.abs(y2 - y1)
      selectionBox.style.left = `${left}px`
      selectionBox.style.top = `${top}px`
      selectionBox.style.width = `${width}px`
      selectionBox.style.height = `${height}px`
    }

    /** 根据当前框选矩形更新选中状态（只计算，不 emit 事件） */
    function updateBoxSelection(flowRect: { x: number; y: number; w: number; h: number }) {
      const nodes = context.actions.getNodes()
      const nodeIds: string[] = []

      for (const n of nodes) {
        if (isNodeInRect(n, flowRect)) {
          nodeIds.push(n.id)
        }
      }

      logger.debug(`碰撞检测: ${nodeIds.length}/${nodes.length} 个节点在框内`, {
        rect: flowRect,
        nodes: nodes.map(n => ({ id: n.id, pos: n.position, dim: (n as any).dimensions })),
        hitIds: nodeIds,
      })

      // 跟上一帧比较，没变化就跳过
      if (nodeIds.length === prevBoxNodeIds.length && nodeIds.every((id, i) => id === prevBoxNodeIds[i])) {
        return
      }
      prevBoxNodeIds = nodeIds

      // 关键：不要直接写 node.selected。
      // 交给 VueFlow 自己的 action，这样 Canvas.vue 的 @nodes-change 还能收到 select 变化。
      // 因为 Shift 也是 VueFlow 的多选键，addSelectedNodes 此时是"追加模式"，
      // 所以这里先清空再选中，保证框选结果等于"当前框内节点"。
      context.actions.removeSelectedElements()
      context.actions.addSelectedNodes(nodes.filter(n => nodeIds.includes(n.id)))
    }

    // ====== Pane 事件处理器 ======

    function onPanePointerDown(e: PointerEvent) {
      // 只处理左键
      if (e.button !== 0) return

      // 只有按住 Shift 才是框选，否则交给 D3 zoom 处理（移动画布 / 单击取消）
      if (!e.shiftKey) return

      const pane = getPaneEl()
      if (!pane) {
        logger.warn('pointerdown: 未找到 pane 元素')
        return
      }

      // 只处理点在空白画布上的事件
      const target = e.target as HTMLElement
      if (
        target.closest('.vue-flow__node') ||
        target.closest('.vue-flow__edge') ||
        target.closest('.vue-flow__handle') ||
        target.closest('.vue-flow__controls') ||
        target.closest('.vue-flow__minimap') ||
        target.closest('.vue-flow__panel')
      ) {
        logger.debug('pointerdown: 点击在节点/边上，忽略')
        return
      }

      // Shift + 左键在空白画布 → 框选模式
      // 拦截 D3 zoom 和 VueFlow Pane 的处理
      e.stopPropagation()
      e.stopImmediatePropagation()
      e.preventDefault()

      startScreenX = e.clientX
      startScreenY = e.clientY
      isBoxSelecting = true
      prevBoxNodeIds = []
      boxDragDistance = 0

      logger.debug('框选开始 (Shift+拖拽)', { x: startScreenX, y: startScreenY })
    }

    function onPointerMove(e: PointerEvent) {
      if (!isBoxSelecting) return

      boxDragDistance = Math.sqrt(
        (e.clientX - startScreenX) ** 2 + (e.clientY - startScreenY) ** 2,
      )

      // 不超过阈值 → 还不是框选
      if (boxDragDistance <= DRAG_THRESHOLD) return

      // 首次超过阈值：创建选择框
      if (!selectionBox) {
        createSelectionBox()
        logger.debug('选择框已创建')
      }

      // 视觉更新 — 屏幕坐标直接定位
      updateSelectionBoxVisual(startScreenX, startScreenY, e.clientX, e.clientY)

      // 逻辑更新 — 将屏幕坐标转换为 flow 坐标做碰撞检测
      const flowTL = screenToFlow(Math.min(startScreenX, e.clientX), Math.min(startScreenY, e.clientY))
      const flowBR = screenToFlow(Math.max(startScreenX, e.clientX), Math.max(startScreenY, e.clientY))

      const flowRect = {
        x: flowTL.x,
        y: flowTL.y,
        w: flowBR.x - flowTL.x,
        h: flowBR.y - flowTL.y,
      }
      logger.debug('框选 flow 坐标:', flowRect)

      updateBoxSelection(flowRect)
    }

    function onPointerUp(_e: PointerEvent) {
      if (!isBoxSelecting) return

      isBoxSelecting = false
      removeSelectionBox()

      if (boxDragDistance > DRAG_THRESHOLD) {
        suppressNextPaneClick = true
        logger.debug(`Shift 框选完成: ${context.selection.getSelectedNodeIds().size} 个节点`)
      }
    }

    function onPaneClickCapture(e: MouseEvent) {
      if (!suppressNextPaneClick) return
      suppressNextPaneClick = false
      e.stopPropagation()
      e.stopImmediatePropagation()
      e.preventDefault()
      logger.debug('已吞掉框选结束后的 pane click，避免清空选中')
    }

    // ====== 快捷键 ======

    function selectAllNodes() {
      const nodes = context.actions.getNodes()
      context.actions.addSelectedNodes(nodes)
      logger.debug(`全选: ${nodes.length} 个节点`)
    }

    function escapeHandler() {
      if (context.selection.getSelectedNodeIds().size === 0 && context.selection.getSelectedEdgeIds().size === 0) return
      clearSelectionInternal()
      logger.debug('已清除选中 (Escape)')
    }

    // ====== 监听 VueFlow 原生选中变化 ======

    const offNodesChange = context.on('nodesChange', (changes: any[]) => {
      // 1) 新节点打标
      for (const c of changes) {
        if (c.type === 'add') {
          patchNodeSelectable(c.id)
        }
      }

      // 2) 选中变化同步
      const selectChanges = changes.filter((c: any) => c.type === 'select')
      if (selectChanges.length === 0) return

      // 不读 getNodes().selected，直接按 VueFlow 给出的 changes 更新；
      // 这样 Shift 加选/减选时不会被内部状态同步时机坑到。
      const selectedNodeIds = context.selection.getSelectedNodeIds()
      for (const c of selectChanges) {
        if (c.selected) selectedNodeIds.add(c.id)
        else selectedNodeIds.delete(c.id)
      }
      context.selection.setSelectedNodeIds(selectedNodeIds, { skipSync: true })
      emitSelectionChange()
    })

    const offEdgesChange = context.on('edgesChange', (changes: any[]) => {
      const selectChanges = changes.filter((c: any) => c.type === 'select')
      if (selectChanges.length === 0) return

      const selectedEdgeIds = context.selection.getSelectedEdgeIds()
      for (const c of selectChanges) {
        if (c.selected) selectedEdgeIds.add(c.id)
        else selectedEdgeIds.delete(c.id)
      }
      context.selection.setSelectedEdgeIds(selectedEdgeIds, { skipSync: true })
      emitSelectionChange()
    })

    const offSelectAll = context.on('selection:selectAll', selectAllNodes)
    const offClear = context.on('selection:clear', escapeHandler)

    // ====== 安装 ======

    // 1. 给现有节点打标
    patchAllNodesSelectable()

    // 2. 不再关闭 elementsSelectable。
    //    关闭它会断掉 VueFlow 的 nodes-change / edges-change 选中事件链。
    logger.info('保留 elementsSelectable=true，仅接管 Shift+拖拽框选')

    // 3. 注册事件
    //    capture: true → 在 D3 zoom / VueFlow Pane 处理之前拦截
    const pane = getPaneEl()
    if (pane) {
      pane.addEventListener('pointerdown', onPanePointerDown, { capture: true })
      pane.addEventListener('click', onPaneClickCapture, { capture: true })
      document.addEventListener('pointermove', onPointerMove, { capture: true })
      document.addEventListener('pointerup', onPointerUp, { capture: true })
    } else {
      logger.warn('未找到 .vue-flow__pane 元素，框选功能不可用')
    }

    // 4. 注册快捷键
    context.registerShortcut('ctrl+a', selectAllNodes)
    context.registerShortcut('escape', escapeHandler)

    logger.info('MultiSelectPlugin v0.7.0 就绪 (Shift+拖拽=框选, 左键拖拽=平移画布)')

    const api: MultiSelectAPI = {
      get selectedNodeIds() { return context.selection.getSelectedNodeIds() },
      get selectedNodes() {
        const selectedNodeIds = context.selection.getSelectedNodeIds()
        return context.actions.getNodes().filter((n: any) => selectedNodeIds.has(n.id))
      },
      selectAll(nodes: any[]) {
        context.actions.addSelectedNodes(nodes)
      },
      clearSelection() {
        clearSelectionInternal()
      },
    }

    return {
      api,
      uninstall() {
        offNodesChange()
        offEdgesChange()
        offSelectAll()
        offClear()
        pane?.removeEventListener('pointerdown', onPanePointerDown, { capture: true })
        pane?.removeEventListener('click', onPaneClickCapture, { capture: true })
        document.removeEventListener('pointermove', onPointerMove, { capture: true })
        document.removeEventListener('pointerup', onPointerUp, { capture: true })
        removeSelectionBox()
      },
    }
  },
}
