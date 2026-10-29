import type { CanvasPlugin, PluginContext } from '../types'
import { toPng } from 'html-to-image'

export interface CanvasExportAPI {
  exportFullCanvas(): Promise<void>
  exportSelectedNodes(): Promise<void>
}

export const CanvasExportPlugin: CanvasPlugin<Record<string, unknown>, CanvasExportAPI> = {
  name: 'canvas-export',
  version: '0.1.0',

  install(context: PluginContext, _options: Record<string, unknown>) {
    const logger = context.logger

    function getFlowEl(): HTMLElement | null {
      return document.querySelector('.vue-flow__viewport')
    }

    async function exportFullCanvas(): Promise<void> {
      const el = getFlowEl()
      if (!el) { logger.warn('未找到画布元素'); return }
      try {
        const dataUrl = await toPng(el, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const link = document.createElement('a')
        link.download = `canvas-export-${Date.now()}.png`
        link.href = dataUrl
        link.click()
        logger.info('画布已导出为 PNG')
        context.emit('canvas-export:exported', { type: 'full' })
      } catch (err) { logger.error('导出画布失败:', err) }
    }

    async function exportSelectedNodes(): Promise<void> {
      const selectedIds = context.selection.getSelectedNodeIds()
      if (selectedIds.size === 0) { logger.warn('没有选中节点'); return }

      const nodeEls: HTMLElement[] = []
      for (const id of selectedIds) {
        const el = document.querySelector(`.vue-flow__node[data-id="${id}"]`) as HTMLElement
        if (el) nodeEls.push(el)
      }
      if (nodeEls.length === 0) { logger.warn('未找到选中节点的 DOM 元素'); return }

      const container = document.createElement('div')
      container.style.cssText = 'position:absolute;left:-9999px;top:-9999px'
      document.body.appendChild(container)

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      const clones: HTMLElement[] = []
      for (const el of nodeEls) {
        const rect = el.getBoundingClientRect()
        minX = Math.min(minX, rect.left); minY = Math.min(minY, rect.top)
        maxX = Math.max(maxX, rect.right); maxY = Math.max(maxY, rect.bottom)
        const clone = el.cloneNode(true) as HTMLElement
        clone.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;transform:none`
        container.appendChild(clone)
        clones.push(clone)
      }
      container.style.width = `${maxX - minX}px`
      container.style.height = `${maxY - minY}px`
      for (const clone of clones) {
        clone.style.left = `${parseFloat(clone.style.left) - minX}px`
        clone.style.top = `${parseFloat(clone.style.top) - minY}px`
      }
      try {
        const dataUrl = await toPng(container, { backgroundColor: '#ffffff', pixelRatio: 2 })
        const link = document.createElement('a')
        link.download = `canvas-selected-${Date.now()}.png`
        link.href = dataUrl
        link.click()
        logger.info(`已导出 ${selectedIds.size} 个选中节点为 PNG`)
        context.emit('canvas-export:exported', { type: 'selected', count: selectedIds.size })
      } catch (err) { logger.error('导出选中节点失败:', err) }
      finally { document.body.removeChild(container) }
    }

    context.registerShortcut('ctrl+e', () => { exportFullCanvas(); return true }, '导出画布为 PNG')
    context.registerShortcut('ctrl+shift+e', () => { exportSelectedNodes(); return true }, '导出选中节点为 PNG')

    const api: CanvasExportAPI = { exportFullCanvas, exportSelectedNodes }
    logger.info('CanvasExportPlugin v0.1.0 ready (Ctrl+E 导出画布, Ctrl+Shift+E 导出选中)')

    return {
      api,
      uninstall() {
        try { context.unregisterShortcut('ctrl+e') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('ctrl+shift+e') } catch (_e) { /* ignore */ }
      },
    }
  },
}
