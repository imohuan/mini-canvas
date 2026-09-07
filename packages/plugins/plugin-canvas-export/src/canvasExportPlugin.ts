/**
 * plugin-canvas-export —— 画布导出 PNG 插件（cordis 最新写法，纯逻辑无 Vue、纯消费方、不对外提供服务）。
 *
 * 复刻老版 packages/canvas-core/src/plugins/canvas-export（CanvasExportPlugin）：
 * - 整张画布导出：把当前 .vue-flow__viewport（VueFlow 渲染的可见视口 DOM）交给 html-to-image 转 PNG；
 * - 选中节点导出：读内核 selection.ids，逐 id 找 .vue-flow__node[data-id] 真实 DOM，克隆到离屏容器后转 PNG。
 *
 * 与 v1 差异（适配 v2 架构）：
 * - 快捷键不走 context.registerShortcut，改用命令 keys 字段（'mod+e' / 'mod+shift+e'），
 *   由渲染层 CanvasHost keydown 统一分发（masterplan 铁律 7）；卸载自动随命令回收。
 * - 无 DOM / 无选中不弹 alert：命令内 console.warn + 直接 return（任务要求）。
 * - 读选中用 ctx.selection.ids（v2 双集里节点桶），不 import 任何 render/core 内部 .vue。
 */
import type { PluginModule, Context } from '@mini-canvas/canvas-base'
import type { SelectionService } from '@mini-canvas/canvas-core-v2'
import { toPng } from 'html-to-image'

/** 类型增强缝：宿主"恒在服务"上 ctx.selection 直访（与 plugin-canvas-commands 同款写法） */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    selection: SelectionService
  }
}

export const name = 'canvas-export'
export const inject = ['selection'] as string[]

/** 取当前画布视口 DOM（VueFlow 渲染约定：整张画布内容在 .vue-flow__viewport 内） */
function getFlowEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.vue-flow__viewport')
}

/** 触发浏览器下载一个 dataURL 为 png 文件 */
function downloadPng(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

/**
 * 把选中的节点真实 DOM 收集并克隆进一个离屏容器（自动按包围盒贴齐）。
 * @returns 离屏容器（已 append 到 body）；无任何可用节点 DOM 时返回 null（调用方 no-op）
 */
function buildSelectedContainer(selectedIds: ReadonlySet<string>): HTMLElement | null {
  const nodeEls: HTMLElement[] = []
  for (const id of selectedIds) {
    // VueFlow 渲染约定：每个节点元素带 data-id（=内核节点 id）
    const selector = '.vue-flow__node[data-id="' + id + '"]'
    const el = document.querySelector<HTMLElement>(selector)
    if (el) nodeEls.push(el)
  }
  if (nodeEls.length === 0) return null

  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px'
  document.body.appendChild(container)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const clones: HTMLElement[] = []
  for (const el of nodeEls) {
    const rect = el.getBoundingClientRect()
    minX = Math.min(minX, rect.left)
    minY = Math.min(minY, rect.top)
    maxX = Math.max(maxX, rect.right)
    maxY = Math.max(maxY, rect.bottom)
    const clone = el.cloneNode(true) as HTMLElement
    clone.style.cssText = 'position:absolute;left:' + rect.left + 'px;top:' + rect.top + 'px;transform:none'
    container.appendChild(clone)
    clones.push(clone)
  }
  container.style.width = (maxX - minX) + 'px'
  container.style.height = (maxY - minY) + 'px'
  for (const clone of clones) {
    clone.style.left = (parseFloat(clone.style.left) - minX) + 'px'
    clone.style.top = (parseFloat(clone.style.top) - minY) + 'px'
  }
  return container
}

export function apply(ctx: Context) {
  const { selection } = ctx

  // —— 导出整张画布为 PNG ——
  async function exportFullCanvas(): Promise<void> {
    const el = getFlowEl()
    if (!el) {
      console.warn('[canvas-export] 未找到画布元素 (.vue-flow__viewport)')
      return
    }
    try {
      const dataUrl = await toPng(el, { backgroundColor: '#ffffff', pixelRatio: 2 })
      downloadPng(dataUrl, 'canvas-export-' + Date.now() + '.png')
      ctx.emit('canvas-export:exported', { type: 'full' })
    } catch (err) {
      console.error('[canvas-export] 导出画布失败:', err)
    }
  }

  // —— 导出选中节点为 PNG ——
  async function exportSelectedNodes(): Promise<void> {
    if (selection.ids.size === 0) {
      console.warn('[canvas-export] 没有选中节点')
      return
    }
    const container = buildSelectedContainer(selection.ids)
    if (!container) {
      console.warn('[canvas-export] 未找到选中节点的 DOM 元素')
      return
    }
    try {
      const dataUrl = await toPng(container, { backgroundColor: '#ffffff', pixelRatio: 2 })
      downloadPng(dataUrl, 'canvas-selected-' + Date.now() + '.png')
      ctx.emit('canvas-export:exported', { type: 'selected', count: selection.ids.size })
    } catch (err) {
      console.error('[canvas-export] 导出选中节点失败:', err)
    } finally {
      document.body.removeChild(container)
    }
  }

  ctx.commands.register({
    id: 'canvas-export:full',
    title: '导出画布',
    keys: ['mod+e'],
    areas: ['pane'],
    group: 'export',
    order: 10,
    run: () => exportFullCanvas(),
  })
  ctx.commands.register({
    id: 'canvas-export:selected',
    title: '导出选中节点',
    keys: ['mod+shift+e'],
    areas: ['pane'],
    group: 'export',
    order: 20,
    run: () => exportSelectedNodes(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const canvasExportPlugin: PluginModule = { name, inject, apply }
