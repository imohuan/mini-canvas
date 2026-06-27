import type { CanvasPlugin, PluginContext, Point } from '../types'

/** 剪贴板数据格式 */
interface ClipboardData {
  nodes: any[]
  edges: any[]
  copyTime: number
}

/** ClipboardPlugin API */
export interface ClipboardAPI {
  /** 手动触发粘贴 */
  paste(): boolean
  /** 手动触发复制 */
  copy(): boolean
  /** 是否有剪贴板数据 */
  readonly hasData: boolean
}

/** 全局剪贴板（跨插件共享） */
let clipboard: ClipboardData | null = null
let pasteCount = 0

/**
 * ClipboardPlugin - 复制粘贴插件
 *
 * @description
 * 提供节点和边的复制/粘贴/剪切功能，支持：
 * - Ctrl+C 复制选中节点（含内连边）
 * - Ctrl+V 粘贴到鼠标位置（自动居中对齐）
 * - Ctrl+X 剪切选中节点
 * - 多次粘贴自动级联偏移（无鼠标时）
 * - 粘贴后自动保持多选状态
 * - 与 MultiSelectPlugin 协作获取选中节点
 *
 * @event clipboard:copy — 复制操作完成时触发
 * @event clipboard:paste — 粘贴操作完成时触发
 *
 * @example
 * ```typescript
 * // 在 App.vue 中使用
 * const clipboardApi = manager.getPluginAPI<ClipboardAPI>('clipboard')
 * clipboardApi?.paste()  // 手动粘贴
 * console.log(clipboardApi?.hasData)  // 是否有剪贴板数据
 * ```
 */
export const ClipboardPlugin: CanvasPlugin<Record<string, unknown>, ClipboardAPI> = {
  name: 'clipboard',
  version: '0.3.0',

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger

    /** 最后已知的画布鼠标位置（屏幕坐标） */
    let lastMousePos: Point | null = null

    // 重置全局剪贴板状态（避免来自旧会话的脏数据）
    clipboard = null
    pasteCount = 0

    // ---- 追踪鼠标位置 ----
    const offPaneMouseMove = context.on('paneMouseMove', (event: MouseEvent) => {
      lastMousePos = { x: event.clientX, y: event.clientY }
    })

    // ---- 辅助函数 ----

    /**
     * 获取当前选中的节点
     * 统一读取画布运行时选中态，避免依赖 MultiSelectPlugin 的内部状态。
     */
    function getSelectedNodeIds(): Set<string> {
      const selectedIds = context.selection.getSelectedNodeIds()
      if (selectedIds.size > 0) return selectedIds
      return new Set(context.actions.getNodes().filter((n: any) => n.selected).map((n: any) => n.id))
    }

    /**
     * 计算粘贴偏移量
     *
     * 1. 有鼠标位置时：将节点组中心对齐鼠标
     * 2. 无鼠标位置时：级联偏移（每次粘贴 +20px）
     */
    function computePasteOffset(nodes: any[]): { offsetX: number; offsetY: number } {
      if (nodes.length === 0) {
        logger.warn('computePasteOffset: nodes array is empty')
        return { offsetX: 50, offsetY: 50 }
      }

      const minX = Math.min(...nodes.map((n: any) => n.position.x))
      const minY = Math.min(...nodes.map((n: any) => n.position.y))
      const maxX = Math.max(...nodes.map((n: any) => n.position.x + ((n as any).dimensions?.width || 256)))
      const maxY = Math.max(...nodes.map((n: any) => n.position.y + ((n as any).dimensions?.height || 256)))
      const groupCenterX = (minX + maxX) / 2
      const groupCenterY = (minY + maxY) / 2

      if (lastMousePos) {
        const flowPos = context.viewport.screenToFlowCoordinate(lastMousePos)
        const result = {
          offsetX: flowPos.x - groupCenterX,
          offsetY: flowPos.y - groupCenterY,
        }
        logger.debug(`粘贴偏移(鼠标): flow=(${flowPos.x},${flowPos.y}) center=(${groupCenterX},${groupCenterY}) offset=(${result.offsetX},${result.offsetY})`)
        return result
      }

      const result = {
        offsetX: 50 + pasteCount * 20,
        offsetY: 50 + pasteCount * 20,
      }
      logger.debug(`粘贴偏移(级联): count=${pasteCount} offset=(${result.offsetX},${result.offsetY})`)
      return result
    }

    /**
     * 将选中节点复制到剪贴板
     *
     * 优先使用 MultiSelectPlugin 的选中集合，
     * 回退到 VueFlow 内置 selected 属性。
     */
    function performCopy(): boolean {
      const selectedIds = getSelectedNodeIds()
      if (selectedIds.size === 0) {
        logger.debug('Copy: 无选中节点，跳过')
        return false
      }

      const allNodes = context.actions.getNodes()
      const selectedNodes = allNodes.filter((n) => selectedIds.has(n.id))

      const allEdges = context.actions.getEdges()
      const edgesToCopy = allEdges.filter(
        (e) => selectedIds.has(e.source) && selectedIds.has(e.target),
      )

      clipboard = {
        nodes: JSON.parse(JSON.stringify(selectedNodes)),
        edges: JSON.parse(JSON.stringify(edgesToCopy)),
        copyTime: Date.now(),
      }
      pasteCount = 0

      logger.info(`Copied: ${clipboard.nodes.length} nodes, ${clipboard.edges.length} edges`)
      logger.debug(`  selectedIds: ${[...selectedIds].join(', ')}`)
      context.emit('clipboard:copy', { nodeCount: clipboard.nodes.length, edgeCount: clipboard.edges.length })
      return true
    }

    /**
     * 粘贴剪贴板内容到画布
     *
     * 1. 为所有节点/边生成新 ID
     * 2. 重新映射边的 source/target
     * 3. 计算鼠标位置偏移
     * 4. 记录历史（支持撤销）
     * 5. 保持粘贴节点的选中状态
     */
    function performPaste(): boolean {
      if (!clipboard || clipboard.nodes.length === 0) {
        logger.debug('Paste: 剪贴板为空，跳过')
        return false
      }

      const idMap = new Map<string, string>()
      const genId = (oldId: string) => {
        const newId = `${oldId}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        idMap.set(oldId, newId)
        return newId
      }

      const { offsetX, offsetY } = computePasteOffset(clipboard.nodes)

      // 1. 克隆节点
      const newNodes = clipboard.nodes.map((n: any) => ({
        ...n,
        id: genId(n.id),
        position: {
          x: n.position.x + offsetX,
          y: n.position.y + offsetY,
        },
        selected: true,
      }))

      // 2. 克隆边并重新映射 source/target
      const newEdges: any[] = []
      for (const e of clipboard.edges) {
        const newSource = idMap.get(e.source)
        const newTarget = idMap.get(e.target)

        if (!newSource || !newTarget) {
          logger.warn(`Paste: 跳过边 ${e.id}，source=${e.source}→${newSource} target=${e.target}→${newTarget}`)
          continue
        }

        // 验证 newSource 和 newTarget 对应的节点确实存在
        const sourceExists = newNodes.some((n: any) => n.id === newSource)
        const targetExists = newNodes.some((n: any) => n.id === newTarget)
        if (!sourceExists || !targetExists) {
          logger.warn(`Paste: 跳过边 ${e.id}，节点映射后不存在 sourceExists=${sourceExists} targetExists=${targetExists}`)
          continue
        }

        const newEdge = {
          ...e,
          id: genId(e.id),
          source: newSource,
          target: newTarget,
          selected: false,
        }

        // 最终验证
        if (!newEdge.source || !newEdge.target) {
          logger.error(`Paste: 边缺少 source/target! id=${newEdge.id} source=${newEdge.source} target=${newEdge.target}`)
          continue
        }

        logger.debug(`Paste: 边映射 ${e.id} → ${newEdge.id}, ${e.source}→${newSource}, ${e.target}→${newTarget}`)
        newEdges.push(newEdge)
      }

      // 3. 记录历史
      const newNodeIds = newNodes.map((n: any) => n.id)
      const newEdgeIds = newEdges.map((e: any) => e.id)

      context.emit('history:record', {
        type: 'addNodes',
        description: `粘贴 ${newNodes.length} 个节点`,
        undo: () => {
          context.actions.removeNodes(newNodeIds)
          context.actions.removeEdges(newEdgeIds)
          logger.debug(`History undo: 删除粘贴的 ${newNodes.length} 个节点`)
        },
        redo: () => {
          context.actions.addNodes(newNodes)
          context.actions.addEdges(newEdges)
          logger.debug(`History redo: 恢复粘贴的 ${newNodes.length} 个节点`)
        },
      })

      // 4. 添加到画布，并将选择状态切换到本次粘贴内容
      context.selection.clearSelection()
      context.actions.addNodes(newNodes)
      if (newEdges.length > 0) {
        logger.debug(`Paste: 添加 ${newEdges.length} 条边`)
        context.actions.addEdges(newEdges)
      }
      context.selection.setSelection({ nodeIds: newNodeIds, edgeIds: [] })

      pasteCount++
      logger.info(`Pasted: ${newNodes.length} nodes, ${newEdges.length} edges at offset(${offsetX},${offsetY})`)
      context.emit('clipboard:paste', {
        nodeCount: newNodes.length,
        edgeCount: newEdges.length,
        position: { x: offsetX, y: offsetY },
      })
      return true
    }

    /** 剪切选中节点到剪贴板 */
    function performCut(): boolean {
      const selectedIds = getSelectedNodeIds()
      if (selectedIds.size === 0) {
        logger.debug('Cut: 无选中节点，跳过')
        return false
      }

      const allNodes = context.actions.getNodes()
      const selectedNodes = allNodes.filter((n) => selectedIds.has(n.id))
      const nodeIds = [...selectedIds]
      const allEdges = context.actions.getEdges()
      const connectedEdges = allEdges.filter(
        (e) => selectedIds.has(e.source) || selectedIds.has(e.target),
      )

      clipboard = {
        nodes: JSON.parse(JSON.stringify(selectedNodes)),
        edges: JSON.parse(JSON.stringify(allEdges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target)))),
        copyTime: Date.now(),
      }
      pasteCount = 0

      context.emit('history:record', {
        type: 'removeNodes',
        description: `剪切 ${nodeIds.length} 个节点`,
        undo: () => {
          context.actions.addNodes(selectedNodes)
          context.actions.addEdges(connectedEdges)
        },
        redo: () => {
          context.actions.removeNodes(nodeIds)
        },
      })

      context.actions.removeNodes(nodeIds)
      context.actions.removeEdges(connectedEdges.map((e: any) => e.id))

      logger.info(`Cut: ${nodeIds.length} nodes`)
      context.emit('clipboard:copy', { nodeCount: clipboard.nodes.length, edgeCount: clipboard.edges.length })
      return true
    }

    // ---- 注册快捷键 ----
    context.registerShortcut('ctrl+c', () => performCopy(), '复制选中节点')
    context.registerShortcut('ctrl+v', () => performPaste(), '粘贴剪切板内容')
    context.registerShortcut('ctrl+x', () => performCut(), '剪切选中节点')
    context.registerShortcut('ctrl+d', () => { performCopy() && performPaste() }, '复制一份选中节点')

    logger.info(`ClipboardPlugin installed. Shortcuts: Ctrl+C/V/X/D`)

    // ---- 监听上下文菜单事件（由 builtinMenuItems 或外部 emit） ----
    const offClipboardCopy = context.on('clipboard:copy', (payload: any) => {
      if (payload?.nodes?.length > 0) {
        const nodes = payload.nodes
        const nodeIds = new Set(nodes.map((n: any) => n.id))
        const allEdges = context.actions.getEdges()
        const edgesToCopy = allEdges.filter(
          (e: any) => nodeIds.has(e.source) && nodeIds.has(e.target),
        )
        clipboard = {
          nodes: JSON.parse(JSON.stringify(nodes)),
          edges: JSON.parse(JSON.stringify(edgesToCopy)),
          copyTime: Date.now(),
        }
        pasteCount = 0
        logger.info(`Copied via event: ${clipboard.nodes.length} nodes, ${clipboard.edges.length} edges`)
      }
    })

    const offClipboardDuplicate = context.on('clipboard:duplicate', (payload: any) => {
      if (payload?.nodes?.length > 0) {
        const nodes = payload.nodes
        const nodeIds = new Set(nodes.map((n: any) => n.id))
        const allEdges = context.actions.getEdges()
        const edgesToCopy = allEdges.filter(
          (e: any) => nodeIds.has(e.source) && nodeIds.has(e.target),
        )
        clipboard = {
          nodes: JSON.parse(JSON.stringify(nodes)),
          edges: JSON.parse(JSON.stringify(edgesToCopy)),
          copyTime: Date.now(),
        }
        pasteCount = 0
        performPaste()
        logger.info(`Duplicated via event: ${clipboard.nodes.length} nodes`)
      }
    })

    return {
      api: {
        paste: () => performPaste(),
        copy: () => performCopy(),
        get hasData() {
          return clipboard !== null && clipboard.nodes.length > 0
        },
      } satisfies ClipboardAPI,
      uninstall() {
        offPaneMouseMove()
        offClipboardCopy()
        offClipboardDuplicate()
        clipboard = null
        pasteCount = 0
      },
    }
  },
}

export default ClipboardPlugin
