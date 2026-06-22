import type { CanvasPlugin, PluginContext } from '../types'
import type { PanelSettingDefinition } from '../../registry/types'
import type { ArrangeDirection, AlignArrangeConfig, AlignArrangeAPI } from './types'
import { computeArrange } from './arrangeEngine'

const DEFAULT_CONFIG: AlignArrangeConfig = { gap: 20, debug: false }

export const AlignArrangePlugin: CanvasPlugin<Partial<AlignArrangeConfig>, AlignArrangeAPI> = {
  name: 'align-arrange',
  version: '0.1.0',

  install(context: PluginContext, options: Partial<AlignArrangeConfig>) {
    const logger = context.logger
    const config: AlignArrangeConfig = { ...DEFAULT_CONFIG, ...options }

    context.panels.registerSetting('align-arrange', {
      id: 'align-arrange.gap', title: '排列间距',
      description: 'Ctrl+方向键排列节点时的间距',
      type: 'slider', group: '排列 align-arrange', order: 70,
      defaultValue: config.gap, min: 0, max: 100, step: 1,
    } as PanelSettingDefinition)

    const gapRef = context.store.toRef('gap', config.gap)

    function getNodeDim(node: any): { w: number; h: number } {
      return {
        w: node.dimensions?.width ?? (node.style?.width ? parseInt(String(node.style.width)) : 200),
        h: node.dimensions?.height ?? (node.style?.height ? parseInt(String(node.style.height)) : 100),
      }
    }

    function arrange(direction: ArrangeDirection): void {
      const selectedIds = context.selection.getSelectedNodeIds()
      if (selectedIds.size < 2) { logger.debug('排列需要至少 2 个选中节点'); return }
      const allNodes = context.actions.getNodes()
      const selectedNodes = allNodes.filter(n => selectedIds.has(n.id))
      if (selectedNodes.length < 2) return

      const nodeRects = selectedNodes.map(n => {
        const pos = (n as any).computedPosition?.x !== undefined ? (n as any).computedPosition : n.position
        const dim = getNodeDim(n)
        return { id: n.id, x: pos.x, y: pos.y, w: dim.w, h: dim.h }
      })

      const oldPositions = new Map(nodeRects.map(r => [r.id, { x: r.x, y: r.y }]))
      const newPositions = computeArrange(nodeRects, direction, gapRef.value)

      context.emit('history:record', {
        type: 'arrangeNodes',
        description: `排列 ${selectedNodes.length} 个节点 (${direction})`,
        undo: () => { for (const [id, pos] of oldPositions) context.actions.updateNode(id, { position: pos } as any) },
        redo: () => { for (const [id, pos] of newPositions) context.actions.updateNode(id, { position: pos } as any) },
      })

      for (const [id, pos] of newPositions) context.actions.updateNode(id, { position: pos } as any)
      logger.info(`排列完成: ${newPositions.size} 个节点, 方向=${direction}`)
    }

    context.registerShortcut('ctrl+arrowleft', () => { arrange('ArrowLeft'); return true }, '向左排列节点')
    context.registerShortcut('ctrl+arrowright', () => { arrange('ArrowRight'); return true }, '向右排列节点')
    context.registerShortcut('ctrl+arrowup', () => { arrange('ArrowUp'); return true }, '向上排列节点')
    context.registerShortcut('ctrl+arrowdown', () => { arrange('ArrowDown'); return true }, '向下排列节点')

    const api: AlignArrangeAPI = {
      arrange,
      setGap(gap: number) { gapRef.value = gap },
      getConfig() { return { gap: gapRef.value, debug: config.debug } },
    }
    logger.info('AlignArrangePlugin v0.1.0 ready (Ctrl+方向键 排列)')

    return {
      api,
      uninstall() {
        try { context.unregisterShortcut('ctrl+arrowleft') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('ctrl+arrowright') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('ctrl+arrowup') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('ctrl+arrowdown') } catch (_e) { /* ignore */ }
      },
    }
  },
}
