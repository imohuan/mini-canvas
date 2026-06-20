/**
 * AutoLayoutPlugin — 智能自动布局插件
 *
 * 功能：
 *   - 嵌套分簇布局（组内节点 / 连通分量 / 孤立节点 / 跨簇 Super-Cluster）
 *   - F 键快速聚焦选中节点
 *   - 双击节点聚焦
 *   - 可配置：方向 (TB/LR/BT/RL)、簇内间距、簇间间距
 *
 * 依赖：group 插件（提供 recalculateBounds）
 */

import type { CanvasPlugin, PluginContext } from '../types'
import type { PanelSettingDefinition } from '../../registry/types'
import type { AutoLayoutConfig, AutoLayoutAPI, AutoLayoutConfigPatch } from './types'
import { runAutoLayout } from './layoutEngine'
import { calculateFocusZoom, centerViewportOnBounds } from './focusViewport'
import { mergeAutoLayoutConfig } from './config'
import { calculateGroupFrameFromAbsoluteChildren } from './groupBounds'

// ═══════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════

const DEFAULT_CONFIG: AutoLayoutConfig = {
  direction: 'LR',
  intraSpacing: { x: 60, y: 80 },
  interSpacing: { x: 120, y: 120 },
  focusHeightRatio: 0.5,
  minZoom: 0.1,
  maxZoom: 4,
  debug: false,
}

// ═══════════════════════════════════════════
// Plugin
// ═══════════════════════════════════════════

export const AutoLayoutPlugin: CanvasPlugin<
  Partial<AutoLayoutConfig>,
  AutoLayoutAPI
> = {
  name: 'auto-layout',
  version: '0.1.0',
  dependencies: ['group'],

  install(context: PluginContext, options: Partial<AutoLayoutConfig>) {
    const logger = context.logger
    const config: AutoLayoutConfig = { ...DEFAULT_CONFIG, ...options }
    let isLayouting = false

    // 注册面板设置项
    context.panels.registerSetting('auto-layout', {
      id: 'auto-layout.direction',
      title: '排列方向',
      description: '节点自动布局的走向',
      type: 'select',
      group: '布局',
      order: 10,
      defaultValue: config.direction,
      options: [
        { value: 'LR', title: '左→右 (LR)' },
        { value: 'TB', title: '上→下 (TB)' },
        { value: 'RL', title: '右→左 (RL)' },
        { value: 'BT', title: '下→上 (BT)' },
      ],
    } as PanelSettingDefinition)

    context.panels.registerSetting('auto-layout', {
      id: 'auto-layout.intraSpacingX',
      title: '组内水平间距',
      description: '同一组内节点之间的水平距离',
      type: 'slider',
      group: '布局',
      order: 20,
      defaultValue: config.intraSpacing.x,
      min: 20,
      max: 300,
      step: 10,
    } as PanelSettingDefinition)

    context.panels.registerSetting('auto-layout', {
      id: 'auto-layout.intraSpacingY',
      title: '组内垂直间距',
      description: '同一组内节点之间的垂直距离',
      type: 'slider',
      group: '布局',
      order: 30,
      defaultValue: config.intraSpacing.y,
      min: 20,
      max: 300,
      step: 10,
    } as PanelSettingDefinition)

    context.panels.registerSetting('auto-layout', {
      id: 'auto-layout.interSpacingX',
      title: '组间水平间距',
      description: '不同组之间的水平距离',
      type: 'slider',
      group: '布局',
      order: 40,
      defaultValue: config.interSpacing.x,
      min: 40,
      max: 500,
      step: 10,
    } as PanelSettingDefinition)

    context.panels.registerSetting('auto-layout', {
      id: 'auto-layout.interSpacingY',
      title: '组间垂直间距',
      description: '不同组之间的垂直距离',
      type: 'slider',
      group: '布局',
      order: 50,
      defaultValue: config.interSpacing.y,
      min: 40,
      max: 500,
      step: 10,
    } as PanelSettingDefinition)

    context.panels.registerSetting('auto-layout', {
      id: 'auto-layout.focusHeightRatio',
      title: '聚焦高度占比',
      description: '聚焦节点时，节点占视口高度的比例',
      type: 'slider',
      group: '布局',
      order: 60,
      defaultValue: config.focusHeightRatio,
      min: 0.1,
      max: 0.9,
      step: 0.05,
    } as PanelSettingDefinition)


    // ==================================================================
    // Core: 自动布局
    // ==================================================================

    function run(configOverride?: AutoLayoutConfigPatch): void {
      if (isLayouting) { logger.warn('自动布局正在进行中，跳过重复调用'); return }
      isLayouting = true
      const effectiveConfig = mergeAutoLayoutConfig(config, configOverride)

      const allNodes = context.actions.getNodes()
      const allEdges = context.actions.getEdges()

      if (allNodes.length === 0) {
        logger.warn('画布无节点，跳过布局')
        return
      }

      const debug = Boolean(effectiveConfig.debug)
      const runId = `layout-${Date.now().toString(36)}`
      const log = (stage: string, payload: unknown) => {
        if (!debug) return
        console.log(`[auto-layout][${runId}] ${stage}`, payload)
      }

      log('00-input', {
        config: effectiveConfig,
        nodes: snapshotForLog(allNodes),
        edges: allEdges.map(e => ({ id: e.id, source: e.source, target: e.target })),
      })

      // 分离 GroupNode 和普通节点
      const groupNodes = allNodes.filter(n => n.type === 'group')
      const groupNodeMap = new Map(groupNodes.map(n => [n.id, n]))

      // ═══ 保存分组归属信息（布局后会清除 parentNode，需要先记录下来）═══
      const groupChildrenMap = new Map<string, Set<string>>()
      for (const g of groupNodes) {
        groupChildrenMap.set(g.id, new Set(
          allNodes.filter(n => n.parentNode === g.id).map(n => n.id),
        ))
      }

      log('01-groups', {
        groupNodes: snapshotForLog(groupNodes),
        groupChildren: [...groupChildrenMap.entries()].map(([groupId, ids]) => ({ groupId, childIds: [...ids] })),
      })

      // 构建 groups 列表供布局引擎使用
      const groups = groupNodes.map(g => ({
        id: g.id,
        nodeIds: groupChildrenMap.get(g.id)!,
      }))

      // 深拷贝节点数据 → 统一转为绝对坐标，清除 parentNode
      const nodeSnapshots = allNodes
        .filter(n => n.type !== 'group')
        .map(n => ({
          ...n,
          position: { ...n.position },
          computedPosition: (n as any).computedPosition
            ? { ...(n as any).computedPosition }
            : undefined,
          dimensions: (n as any).dimensions ? { ...(n as any).dimensions } : undefined,
          style: n.style ? { ...n.style } : undefined,
        }))

      for (const node of nodeSnapshots) {
        const parentNodeId = (node as any).parentNode
        if (parentNodeId && (node as any).computedPosition?.x !== undefined) {
          const cPos = (node as any).computedPosition
          node.position = { x: cPos.x, y: cPos.y }
          log('02-absolute-from-computedPosition', { id: node.id, parentNode: parentNodeId, absolute: node.position })
        } else if (parentNodeId) {
          const parent = groupNodeMap.get(parentNodeId)
          if (parent) {
            node.position = {
              x: parent.position.x + node.position.x,
              y: parent.position.y + node.position.y,
            }
            log('02-absolute-from-parent-plus-relative', {
              id: node.id,
              parentNode: parentNodeId,
              parentPosition: parent.position,
              absolute: node.position,
            })
          } else {
            log('02-missing-parent-fallback-relative', { id: node.id, parentNode: parentNodeId, relative: node.position })
          }
        }
        delete (node as any).computedPosition
        delete (node as any).parentNode
        delete (node as any).extent
      }

      log('03-nodeSnapshots-absolute', snapshotForLog(nodeSnapshots))

      // 边快照
      const edgeSnapshots = allEdges.map(e => ({ ...e }))

      // 运行布局引擎
      const result = runAutoLayout({
        nodes: nodeSnapshots,
        edges: edgeSnapshots,
        groups: groups.map(g => ({ id: g.id, nodeIds: g.nodeIds })),
        config: effectiveConfig,
      })

      logger.info(`Layout completed: ${result.nodes.length} nodes repositioned`)
      log('04-layout-result', {
        resultNodes: snapshotForLog(result.nodes),
        engineLogs: result.logs,
      })

      // ═══ 写入绝对坐标到 VueFlow，清除 parentNode（脱离组）═══
      for (const sn of result.nodes) {
        context.actions.updateNode(sn.id, {
          position: sn.position,
          parentNode: undefined,
          extent: undefined,
        })
      }

      context.selection.clearSelection()

      const resultNodeMap = new Map(result.nodes.map(n => [n.id, n]))

      // ═══ rAF: 重算 Group bounds + 更新 GroupNode + 重新归位子节点 ═══
      requestAnimationFrame(() => {
        for (const g of groupNodes) {
          const childIds = groupChildrenMap.get(g.id)!
          if (childIds.size === 0) continue

          // 必须使用布局引擎刚算出的绝对坐标。
          // 不能从 VueFlow 立刻读 freshNodes：updateNode 是异步的，可能读到旧的相对坐标，
          // 连续点自动布局时就会把组和单节点越推越远。
          const children = [...childIds]
            .map(cid => resultNodeMap.get(cid))
            .filter((n): n is NonNullable<typeof n> => Boolean(n))
          const frame = calculateGroupFrameFromAbsoluteChildren(children)
          if (!frame) continue
          log('05-group-frame', {
            groupId: g.id,
            children: snapshotForLog(children),
            frame,
          })

          // 更新 GroupNode
          context.actions.updateNode(g.id, {
            position: { x: frame.x, y: frame.y },
            style: { width: `${frame.w}px`, height: `${frame.h}px` },
          })

          // 将子节点坐标转为相对组坐标并重新关联 parentNode
          for (const cn of children) {
            const relativePosition = { x: cn.position.x - frame.x, y: cn.position.y - frame.y }
            log('06-reparent-child', {
              groupId: g.id,
              childId: cn.id,
              absolute: cn.position,
              groupFrame: frame,
              relative: relativePosition,
            })
            context.actions.updateNode(cn.id, {
              position: relativePosition,
              parentNode: g.id,
            })
          }

          logger.debug(`Group ${g.id}: bounds (${frame.x.toFixed(0)},${frame.y.toFixed(0)}) ${frame.w.toFixed(0)}x${frame.h.toFixed(0)}`)
        }

        // 布局后只移动视图到布局结果中心，不再 fitView 把视图缩得很小
        requestAnimationFrame(() => {
          focusBounds(result.nodes, { keepZoom: true })
          isLayouting = false
          if (debug) {
            requestAnimationFrame(() => {
              log('07-final-vueflow-state', snapshotForLog(context.actions.getNodes()))
            })
          }
        })
      })
    }

    function snapshotForLog(nodes: any[]) {
      return nodes.map(n => ({
        id: n.id,
        type: n.type,
        parentNode: n.parentNode,
        position: n.position ? { x: round(n.position.x), y: round(n.position.y) } : undefined,
        computedPosition: n.computedPosition ? { x: round(n.computedPosition.x), y: round(n.computedPosition.y) } : undefined,
        dimensions: n.dimensions ? { width: round(n.dimensions.width), height: round(n.dimensions.height) } : undefined,
        style: typeof n.style === 'object' ? { width: n.style?.width, height: n.style?.height } : undefined,
        data: n.data ? { label: n.data.label, nodeType: n.data.nodeType } : undefined,
      }))
    }

    function round(v: unknown) {
      return typeof v === 'number' ? Math.round(v * 100) / 100 : v
    }

    // ==================================================================
    // 聚焦选中节点
    // ==================================================================

    function focusSelected(): boolean {
      const selectedIds = context.selection.getSelectedNodeIds()
      if (selectedIds.size === 0) {
        logger.info('focusSelected: no nodes selected')
        return false
      }

      const allNodes = context.actions.getNodes()
      const selNodes = allNodes.filter(n => selectedIds.has(n.id))
      if (selNodes.length === 0) return false

      focusBounds(selNodes, { keepZoom: false })
      logger.info(`Focused on ${selNodes.length} node(s)`)
      return true
    }

    function focusNode(nodeId: string): boolean {
      const allNodes = context.actions.getNodes()
      const node = allNodes.find(n => n.id === nodeId)
      if (!node) return false

      focusBounds([node], { keepZoom: false })
      logger.info(`Focused on node: ${nodeId}`)
      return true
    }

    function getNodeDim(node: any): { w: number; h: number } {
      return {
        w: node.dimensions?.width ?? (typeof node.style === 'object' && node.style?.width ? parseFloat(String(node.style.width)) : 200),
        h: node.dimensions?.height ?? (typeof node.style === 'object' && node.style?.height ? parseFloat(String(node.style.height)) : 100),
      }
    }

    function getBounds(nodes: any[]) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const node of nodes) {
        const pos = getAbsolutePos(node)
        const dim = getNodeDim(node)
        minX = Math.min(minX, pos.x)
        minY = Math.min(minY, pos.y)
        maxX = Math.max(maxX, pos.x + dim.w)
        maxY = Math.max(maxY, pos.y + dim.h)
      }
      return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    }

    function getViewportSize(): { width: number; height: number } {
      const el = document.querySelector('.vue-flow') as HTMLElement | null
      const rect = el?.getBoundingClientRect()
      return {
        width: rect?.width || window.innerWidth || 1,
        height: rect?.height || window.innerHeight || 1,
      }
    }

    function focusBounds(nodes: any[], options: { keepZoom: boolean }) {
      if (nodes.length === 0) return
      const bounds = getBounds(nodes)
      const viewport = context.viewport.getViewport()
      const size = getViewportSize()
      const zoom = options.keepZoom
        ? viewport.zoom
        : calculateFocusZoom({
            boundsHeight: bounds.height,
            viewportHeight: size.height,
            heightRatio: config.focusHeightRatio,
            minZoom: config.minZoom,
            maxZoom: config.maxZoom,
          })
      context.viewport.setViewport(centerViewportOnBounds({
        bounds,
        viewportWidth: size.width,
        viewportHeight: size.height,
        zoom,
      }))
    }

    function getAbsolutePos(node: any): { x: number; y: number } {
      // 分组子节点的 position 是相对父组的，computedPosition 才是绝对坐标
      if (node.parentNode && node.computedPosition && node.computedPosition.x !== undefined) {
        return { x: node.computedPosition.x, y: node.computedPosition.y }
      }
      return { x: node.position.x, y: node.position.y }
    }

    // ==================================================================
    // 快捷键注册
    // ==================================================================

    context.registerShortcut('f', () => {
      focusSelected()
      return true
    }, '聚焦选中节点')

    context.registerShortcut('ctrl+l', () => {
      run()
      return true
    }, '自动布局所有节点')

    context.registerShortcut('r', () => {
      context.viewport.fitView()
      return true
    }, '恢复画布适应视图')

    // ==================================================================
    // Config API
    // ==================================================================

    function getConfig(): AutoLayoutConfig {
      return { ...config }
    }

    function setConfig(partial: AutoLayoutConfigPatch): void {
      if (partial.direction) config.direction = partial.direction
      if (partial.intraSpacing) {
        if (partial.intraSpacing.x !== undefined) config.intraSpacing.x = partial.intraSpacing.x
        if (partial.intraSpacing.y !== undefined) config.intraSpacing.y = partial.intraSpacing.y
      }
      if (partial.interSpacing) {
        if (partial.interSpacing.x !== undefined) config.interSpacing.x = partial.interSpacing.x
        if (partial.interSpacing.y !== undefined) config.interSpacing.y = partial.interSpacing.y
      }
      if (partial.focusHeightRatio !== undefined) config.focusHeightRatio = partial.focusHeightRatio
      if (partial.minZoom !== undefined) config.minZoom = partial.minZoom
      if (partial.maxZoom !== undefined) config.maxZoom = partial.maxZoom
      if (partial.debug !== undefined) config.debug = partial.debug
    }

    // ==================================================================
    // API
    // ==================================================================

    const api: AutoLayoutAPI = {
      run,
      getConfig,
      setConfig,
      focusSelected,
      focusNode,
    }

    logger.info('AutoLayoutPlugin v0.1.0 ready (F 聚焦, Ctrl+L 自动布局)')

    return {
      api,
      uninstall() {
        try { context.unregisterShortcut('f') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('ctrl+l') } catch (_e) { /* ignore */ }
        try { context.unregisterShortcut('r') } catch (_e) { /* ignore */ }
      },
    }
  },
}
