import type { CanvasPlugin, PluginContext } from '../types'

/** 历史记录条目 */
export interface HistoryRecord {
  /** 操作类型 */
  type: string
  /** 撤销回调 */
  undo: () => void
  /** 重做回调 */
  redo: () => void
  /** 时间戳 */
  timestamp: number
  /** 操作描述 */
  description: string
}

/** HistoryPlugin 配置选项 */
export interface HistoryOptions {
  /** 最大历史记录数（默认 100） */
  maxRecords?: number
  [key: string]: unknown
}

/** HistoryPlugin 暴露的 API */
export interface HistoryAPI {
  /** 是否可以撤销 */
  readonly canUndo: boolean
  /** 是否可以重做 */
  readonly canRedo: boolean
  /** 是否正在执行撤销/重做 */
  readonly isRestoring: boolean
  /** 撤销栈大小 */
  readonly undoCount: number
  /** 重做栈大小 */
  readonly redoCount: number
  /** 执行一次撤销 */
  undo(): void
  /** 执行一次重做 */
  redo(): void
  /** 清空所有历史 */
  clear(): void
  /** 开始批量记录（将多次操作合并为一条记录） */
  beginBatch(): void
  /** 结束批量记录 */
  endBatch(): void
  /** 记录一条历史 */
  record(record: Omit<HistoryRecord, 'timestamp'>): void
}

/**
 * HistoryPlugin - 撤销重做插件
 *
 * @description
 * 基于命令模式（Command Pattern）的撤销/重做系统。
 *
 * **自动记录：**
 * - 节点拖拽（nodeDragStart → nodeDragStop 合并为一条批量记录）
 * - Delete/Backspace 删除节点
 * - VueFlow connect 连线操作
 *
 * **快捷键：**
 * - Ctrl+Z：撤销
 * - Ctrl+Y / Ctrl+Shift+Z：重做
 *
 * **关键设计：**
 * - 直接修改响应式 node.position（避免 `updateNode` 在 undo/redo 中不刷新 UI）
 * - `isRestoring` 锁防止撤销/重做期间触发新的历史记录
 * - 批量操作（beginBatch/endBatch）合并多次拖拽为一条记录
 *
 * @event history:state-change — 历史状态变化时触发，携带 { canUndo, canRedo, isRestoring, undoCount, redoCount }
 * @event history:record — 其他插件通过此事件注册历史记录
 *
 * @example
 * ```typescript
 * const historyApi = manager.getPluginAPI<HistoryAPI>('history')
 * if (historyApi) { historyApi.undo() }
 * ```
 */
export const HistoryPlugin: CanvasPlugin<HistoryOptions, HistoryAPI> = {
  name: 'history',
  version: '0.3.0',

  install(context: PluginContext, options: HistoryOptions) {
    const logger = context.logger
    const maxRecords = options.maxRecords ?? 100

    const undoStack: HistoryRecord[] = []
    const redoStack: HistoryRecord[] = []
    let isRestoring = false
    let currentBatch: HistoryRecord[] | null = null
    let dragStartPositions: Map<string, { x: number; y: number }> | null = null

    /** 发射状态变化事件 */
    function emitState() {
      context.emit('history:state-change', {
        canUndo: undoStack.length > 0,
        canRedo: redoStack.length > 0,
        isRestoring,
        undoCount: undoStack.length,
        redoCount: redoStack.length,
      })
      logger.debug(
        `State: undo=${undoStack.length} redo=${redoStack.length} restoring=${isRestoring} batch=${currentBatch !== null}`,
      )
    }

    // ====================================================================
    // API 实现
    // ====================================================================

    const api: HistoryAPI = {
      get canUndo() { return undoStack.length > 0 },
      get canRedo() { return redoStack.length > 0 },
      get isRestoring() { return isRestoring },
      get undoCount() { return undoStack.length },
      get redoCount() { return redoStack.length },

      record(record: Omit<HistoryRecord, 'timestamp'>) {
        if (isRestoring) {
          logger.debug(`record 跳过 (isRestoring=true): ${record.description}`)
          return
        }
        if (currentBatch) {
          currentBatch.push({ ...record, timestamp: Date.now() })
          logger.debug(`record 加入批量: ${record.description} (batch: ${currentBatch.length})`)
          return
        }
        undoStack.push({ ...record, timestamp: Date.now() })
        if (undoStack.length > maxRecords) {
          const removed = undoStack.shift()
          logger.debug(`record 超出上限，移除旧记录: ${removed?.description}`)
        }
        redoStack.length = 0
        logger.debug(`record: ${record.description} | undo=${undoStack.length} redo=0`)
        emitState()
      },

      beginBatch() {
        currentBatch = []
        logger.debug('beginBatch')
      },
      endBatch() {
        if (!currentBatch || currentBatch.length === 0) {
          logger.debug('endBatch: 空批量，跳过')
          currentBatch = null
          return
        }
        const batch = [...currentBatch]
        const batchDesc = batch[0]?.description || `批量操作 (${batch.length} 步)`

        undoStack.push({
          type: 'batch',
          undo: () => {
            isRestoring = true
            logger.debug(`batch undo: ${batch.length} records`)
            for (let i = batch.length - 1; i >= 0; i--) {
              try { batch[i].undo() } catch (e) { logger.error('batch undo error:', e) }
            }
            isRestoring = false
            emitState()
          },
          redo: () => {
            isRestoring = true
            logger.debug(`batch redo: ${batch.length} records`)
            for (const r of batch) {
              try { r.redo() } catch (e) { logger.error('batch redo error:', e) }
            }
            isRestoring = false
            emitState()
          },
          timestamp: Date.now(),
          description: batchDesc,
        })
        if (undoStack.length > maxRecords) undoStack.shift()
        redoStack.length = 0
        currentBatch = null
        logger.debug(`endBatch: "${batchDesc}" | undo=${undoStack.length}`)
        emitState()
      },

      undo() {
        if (undoStack.length === 0) {
          logger.debug('undo: 栈为空')
          return
        }
        isRestoring = true
        const record = undoStack.pop()!
        logger.info(`↩ Undo: ${record.description}`)
        try {
          record.undo()
        } catch (err) {
          logger.error('Undo 失败:', err)
        }
        redoStack.push(record)
        if (redoStack.length > maxRecords) redoStack.shift()
        isRestoring = false
        emitState()
      },

      redo() {
        if (redoStack.length === 0) {
          logger.debug('redo: 栈为空')
          return
        }
        isRestoring = true
        const record = redoStack.pop()!
        logger.info(`↪ Redo: ${record.description}`)
        try {
          record.redo()
        } catch (err) {
          logger.error('Redo 失败:', err)
        }
        undoStack.push(record)
        if (undoStack.length > maxRecords) undoStack.shift()
        isRestoring = false
        emitState()
      },

      clear() {
        logger.info('clear: 清空所有历史')
        undoStack.length = 0
        redoStack.length = 0
        currentBatch = null
        dragStartPositions = null
        isRestoring = false
        emitState()
      },
    }

    // ====================================================================
    // 快捷键注册
    // ====================================================================
    context.registerShortcut('ctrl+z', () => api.undo(), '撤销')
    context.registerShortcut('ctrl+shift+z', () => api.redo(), '重做 (Shift+Z)')
    context.registerShortcut('ctrl+y', () => api.redo(), '重做 (Ctrl+Y)')
    logger.info('Shortcuts: Ctrl+Z (undo), Ctrl+Y/Ctrl+Shift+Z (redo)')

    // ====================================================================
    // 外部命令事件
    // ====================================================================
    const offRecord = context.on('history:record', (record: Omit<HistoryRecord, 'timestamp'>) => api.record(record))
    const offBeginBatch = context.on('history:begin-batch', () => api.beginBatch())
    const offEndBatch = context.on('history:end-batch', () => api.endBatch())
    const offClear = context.on('history:clear', () => api.clear())
    const offUndo = context.on('history:undo', () => api.undo())
    const offRedo = context.on('history:redo', () => api.redo())

    // ====================================================================
    // 自动记录：节点拖拽
    // ====================================================================
    const offNodeDragStart = context.on('nodeDragStart', ({ node }: any) => {
      if (isRestoring) return
      dragStartPositions = new Map()
      const allNodes = context.actions.getNodes()
      for (const n of allNodes) {
        if ((n as any).selected || n.id === node.id) {
          dragStartPositions.set(n.id, { x: n.position.x, y: n.position.y })
        }
      }
      api.beginBatch()
      logger.debug(`nodeDragStart: node=${node.id}, tracking ${dragStartPositions.size} nodes`)
    })

    const offNodeDragStop = context.on('nodeDragStop', () => {
      if (isRestoring || !dragStartPositions || dragStartPositions.size === 0) {
        api.endBatch()
        dragStartPositions = null
        return
      }

      const startPositions = new Map(dragStartPositions)
      const allNodes = context.actions.getNodes()

      for (const [nodeId, startPos] of startPositions) {
        const currentNode = allNodes.find((n) => n.id === nodeId)
        if (!currentNode) continue
        const endPos = { x: currentNode.position.x, y: currentNode.position.y }
        if (endPos.x === startPos.x && endPos.y === startPos.y) continue

        const sPos = { x: startPos.x, y: startPos.y }
        const ePos = { x: endPos.x, y: endPos.y }

        api.record({
          type: 'moveNodes',
          description: `移动节点 ${nodeId} (${sPos.x},${sPos.y}) → (${ePos.x},${ePos.y})`,
          undo: () => {
            const n = context.actions.getNodes().find((n2) => n2.id === nodeId)
            if (n) {
              n.position.x = sPos.x
              n.position.y = sPos.y
              logger.debug(`  undo moveNode: ${nodeId} → (${sPos.x},${sPos.y})`)
            }
          },
          redo: () => {
            const n = context.actions.getNodes().find((n2) => n2.id === nodeId)
            if (n) {
              n.position.x = ePos.x
              n.position.y = ePos.y
              logger.debug(`  redo moveNode: ${nodeId} → (${ePos.x},${ePos.y})`)
            }
          },
        })
      }

      api.endBatch()
      dragStartPositions = null
    })

    // ====================================================================
    // 自动记录：连线
    // ====================================================================
    const offConnect = context.on('connect', () => {
      if (isRestoring) return

      const edges = context.actions.getEdges()
      const addedEdge = edges[edges.length - 1]
      if (!addedEdge) return

      const edgeId = addedEdge.id
      const savedEdge = { ...addedEdge }
      savedEdge.data = JSON.parse(JSON.stringify(addedEdge.data || {}))

      api.record({
        type: 'addEdges',
        description: `连线 ${savedEdge.source} → ${savedEdge.target}`,
        undo: () => {
          context.actions.removeEdges([edgeId])
          logger.debug(`  undo connect: remove ${edgeId}`)
        },
        redo: () => {
          context.actions.addEdges([savedEdge])
          logger.debug(`  redo connect: add ${edgeId}`)
        },
      })
    })

    // ====================================================================
    // 自动记录：键盘删除（Delete / Backspace）
    // ====================================================================
    function deleteHandler() {
      if (isRestoring) return

      const allNodes = context.actions.getNodes()
      const selectedNodes = allNodes.filter((n: any) => n.selected)
      if (selectedNodes.length === 0) return

      const nodeIds = selectedNodes.map((n) => n.id)
      const deletedNodes = JSON.parse(JSON.stringify(selectedNodes))
      const allEdges = context.actions.getEdges()
      const ns = new Set(nodeIds)
      const connectedEdges = allEdges.filter((e) => ns.has(e.source) || ns.has(e.target))
      const deletedEdges = JSON.parse(JSON.stringify(connectedEdges))

      logger.info(`Delete: ${nodeIds.length} nodes + ${deletedEdges.length} edges`)

      api.record({
        type: 'removeNodes',
        description: `删除 ${nodeIds.length} 个节点`,
        undo: () => {
          context.actions.addNodes(deletedNodes)
          context.actions.addEdges(deletedEdges)
          logger.debug(`  undo delete: restore ${deletedNodes.length} nodes`)
        },
        redo: () => {
          context.actions.removeNodes(nodeIds)
          logger.debug(`  redo delete: remove ${nodeIds.length} nodes`)
        },
      })

      context.actions.removeNodes(nodeIds)
      context.actions.removeEdges(connectedEdges.map((e: any) => e.id))
    }

    context.registerShortcut('delete', deleteHandler, '删除选中节点')
    context.registerShortcut('backspace', deleteHandler, '删除选中节点')
    logger.info('Auto-record: 拖拽 / 连线 / Delete/Backspace 删除')

    emitState()

    return {
      api,
      uninstall() {
        offRecord()
        offBeginBatch()
        offEndBatch()
        offClear()
        offUndo()
        offRedo()
        offNodeDragStart()
        offNodeDragStop()
        offConnect()
        logger.info('HistoryPlugin cleaned up')
      },
    }
  },
}
