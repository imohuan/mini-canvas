/**
 * plugin-canvas-export —— 画布导出 PNG 插件（cordis 最新写法，纯逻辑无 Vue、纯消费方、不对外提供服务）。
 *
 * 复刻老版 packages/canvas-core/src/plugins/canvas-export（CanvasExportPlugin）：
 * - 整张画布导出：把当前 .vue-flow__viewport（VueFlow 渲染的可见视口 DOM）交给 html-to-image 转 PNG；
 * - 选中节点导出：渲染整画布 → 按选中节点原始屏幕包围盒 + Config.exportSelectedRectPadding 像素扩展裁剪出 PNG。
 *   节点本体/连线/背景完整保留，仅剔除节点上挂载的端口交互件（MovingHandle 的圆球/吸附区/调试叠加）。
 *
 * 调试可视化剔除（导出图不该带调试框）：
 * - 主题插件(plugin-theme-default)在节点里渲染 .moving-handle-debug(端口几何辅助线) 与 .v2-debug-overlay(吸附带/接收区)
 *   两种调试 SVG；本插件经 html-to-image filter 在克隆阶段直接跳过它们（不动 DOM、无闪烁、导出后无需恢复）。
 *
 * 与 v1 差异（适配 v2 架构）：
 * - 快捷键不走 context.registerShortcut，改用命令 keys 字段（'mod+e' / 'mod+shift+e'），
 *   由渲染层 CanvasHost keydown 统一分发（masterplan 铁律 7）；卸载自动随命令回收。
 * - 无 DOM / 无选中不弹 alert：命令内 console.warn + 直接 return（任务要求）。
 * - 读选中用 ctx.selection.ids（v2 双集里节点桶），不 import 任何 render/core 内部 .vue。
 * - P4 Config：模块级 `Config` schema 暴露可调项 `exportSelectedRectPadding`（默认 4 像素），由内核补默认后传 apply。
 */
import type {
  PluginModule,
  Context,
  ConfigSchema,
  InferConfig,
} from '@mini-canvas/canvas-base'
import type { SelectionService } from '@mini-canvas/canvas-core-v2'
import { toCanvas } from 'html-to-image'

/** 类型增强缝：宿主"恒在服务"上 ctx.selection 直访（与 plugin-canvas-commands 同款写法） */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    selection: SelectionService
  }
}

export const name = 'canvas-export'
export const inject = ['selection'] as string[]

/** P4 模块级 Config schema：仅暴露"选中导出包围盒扩展像素"一个调项。 */
export const Config: ConfigSchema = {
  exportSelectedRectPadding: {
    type: 'number',
    default: 4,
    min: 0,
    max: 64,
    step: 1,
    label: '选中导出扩展像素',
    group: '导出',
    description:
      '选中节点导出 PNG 时，包围盒向外扩展的像素数（默认 4，避免边缘裁到连接线/光晕）。',
  },
}

/** apply 收到的 config TS 类型（与 schema 对齐） */
export interface CanvasExportConfig extends InferConfig<typeof Config> {}

/** 取当前画布视口 DOM（VueFlow 渲染约定：整张画布内容在 .vue-flow__viewport 内）。 */
function getFlowEl(ctx: Context): HTMLElement | null {
  const vp = ctx.get<{ getRootEl(): HTMLElement | null; getRendererEl(): HTMLElement | null } | undefined>('viewport')
  const root = vp?.getRootEl?.() ?? null
  const renderer = vp?.getRendererEl?.() ?? null
  const flowViewport = root?.querySelector<HTMLElement>('.vue-flow__viewport') ?? null
  if (flowViewport) return flowViewport
  return renderer ?? null
}

/** 主题调试可视化容器的类名（导出时经 html-to-image filter 剔除；与 plugin-theme-default BaseNode/MovingHandle 约定） */
const DEBUG_OVERLAY_CLASSES = ['moving-handle-debug', 'v2-debug-overlay', 'port-follow-zone', 'moving-handle-button']

/** html-to-image filter：剔除画布节点上的调试叠加（端口半圆/圆心/rest/mouse 辅助线、吸附带/接收区）。 */
function excludeDebugOverlay(domNode: HTMLElement): boolean {
  const cls = typeof domNode.classList?.contains === 'function' ? domNode.classList : null
  if (!cls) return true
  return !DEBUG_OVERLAY_CLASSES.some((name) => cls.contains(name))
}

/** 把目标元素渲染成 canvas（共享 filter：调试叠加不进入导出图） */
function renderToCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  return toCanvas(el, {
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    filter: excludeDebugOverlay,
  })
}

/** 触发浏览器下载一个 dataURL 为 png 文件 */
function downloadPng(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

/** 收集选中节点的真实 DOM 元素（在本画布实例根内查 data-id，多宿主不串线）。 */
function collectSelectedNodeEls(
  selectedIds: ReadonlySet<string>,
  scopeRoot?: HTMLElement | null,
): HTMLElement[] {
  const nodeEls: HTMLElement[] = []
  for (const id of selectedIds) {
    const selector = '.vue-flow__node[data-id="' + id + '"]'
    const el = scopeRoot
      ? scopeRoot.querySelector<HTMLElement>(selector)
      : document.querySelector<HTMLElement>(selector)
    if (el) nodeEls.push(el)
  }
  return nodeEls
}

export function apply(ctx: Context) {
  const { selection } = ctx

  function getFlowRect(): { el: HTMLElement; left: number; top: number; width: number; height: number } | null {
    const el = getFlowEl(ctx)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return { el, left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }

  function cropCanvasPng(
    source: HTMLCanvasElement,
    scale: number,
    region: { x: number; y: number; width: number; height: number },
  ): string {
    const out = document.createElement('canvas')
    const s = scale > 0 ? scale : 1
    out.width = Math.max(1, Math.round(region.width * s))
    out.height = Math.max(1, Math.round(region.height * s))
    const sctx = source.getContext('2d')
    const octx = out.getContext('2d')
    if (!sctx || !octx) return ''
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, out.width, out.height)
    octx.drawImage(
      source,
      Math.round(region.x * s),
      Math.round(region.y * s),
      Math.max(1, Math.round(region.width * s)),
      Math.max(1, Math.round(region.height * s)),
      0,
      0,
      out.width,
      out.height,
    )
    return out.toDataURL('image/png')
  }

  function canvasScaleOf(canvas: HTMLCanvasElement, el: HTMLElement): number {
    const cssW = el.clientWidth || el.getBoundingClientRect().width
    if (cssW <= 0) return 2
    return canvas.width / cssW
  }

  // —— 导出整张画布为 PNG ——
  async function exportFullCanvas(): Promise<void> {
    const flow = getFlowRect()
    if (!flow) {
      console.warn('[canvas-export] 未找到画布元素 (.vue-flow__viewport)')
      return
    }
    try {
      const canvas = await renderToCanvas(flow.el)
      const dataUrl = canvas.toDataURL('image/png')
      downloadPng(dataUrl, 'canvas-export-' + Date.now() + '.png')
      ctx.emit('canvas-export:exported', { type: 'full' })
    } catch (err) {
      console.error('[canvas-export] 导出画布失败:', err)
    }
  }

  // —— 导出选中节点为 PNG ——
  // 行为：渲染整画布（节点完整保留）→ 按选中节点屏幕包围盒 + padding 裁剪出 PNG。
  //       端口交互件（MovingHandle 圆球/吸附区/调试叠加）经 filter 剔除，不进导出图。
  async function exportSelectedNodes(): Promise<void> {
    if (selection.ids.size === 0) {
      console.warn('[canvas-export] 没有选中节点')
      return
    }
    const vp = ctx.get<{ getRootEl(): HTMLElement | null } | undefined>('viewport')
    const flow = getFlowRect()
    if (!flow) {
      console.warn('[canvas-export] 未找到画布元素 (.vue-flow__viewport)')
      return
    }
    const nodeEls = collectSelectedNodeEls(selection.ids, vp?.getRootEl?.())
    if (nodeEls.length === 0) {
      console.warn('[canvas-export] 未找到选中节点的 DOM 元素')
      return
    }
    // 实时读设置面板的扩展像素（用户改过就生效；不缓存 apply 时的 config，避免永远默认 4）
    const settings = ctx.get<{ get(key: string): string | number | boolean | undefined } | undefined>('settings')
    const rawPadding = settings?.get('exportSelectedRectPadding')
    const padding = Math.max(0, Number(rawPadding === undefined || rawPadding === null ? 4 : rawPadding))
    // 选中节点屏幕包围盒（屏幕坐标，导出前取）
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const el of nodeEls) {
      const rect = el.getBoundingClientRect()
      minX = Math.min(minX, rect.left)
      minY = Math.min(minY, rect.top)
      maxX = Math.max(maxX, rect.right)
      maxY = Math.max(maxY, rect.bottom)
    }
    // 包围盒 + padding → 屏幕坐标 → 视口内坐标
    const padded = {
      left: minX - padding,
      top: minY - padding,
      right: maxX + padding,
      bottom: maxY + padding,
    }
    const region = {
      x: Math.max(0, padded.left - flow.left),
      y: Math.max(0, padded.top - flow.top),
      width: Math.min(flow.width, padded.right - flow.left) - Math.max(0, padded.left - flow.left),
      height: Math.min(flow.height, padded.bottom - flow.top) - Math.max(0, padded.top - flow.top),
    }
    if (region.width <= 0 || region.height <= 0) {
      console.warn('[canvas-export] 选中节点不在可视区域内，无法导出')
      return
    }
    try {
      const canvas = await renderToCanvas(flow.el)
      const scale = canvasScaleOf(canvas, flow.el)
      const dataUrl = cropCanvasPng(canvas, scale, region)
      if (!dataUrl) {
        console.warn('[canvas-export] 裁剪选中节点区域失败')
        return
      }
      downloadPng(dataUrl, 'canvas-selected-' + Date.now() + '.png')
      ctx.emit('canvas-export:exported', { type: 'selected', count: selection.ids.size })
    } catch (err) {
      console.error('[canvas-export] 导出选中节点失败:', err)
    }
  }

  ctx.commands.register({
    id: 'canvas-export:full',
    title: '导出画布',
    keys: ['mod+e'],
    group: 'export',
    order: 10,
    run: () => exportFullCanvas(),
  })
  ctx.commands.register({
    id: 'canvas-export:selected',
    title: '导出选中节点',
    keys: ['mod+shift+e'],
    group: 'export',
    order: 20,
    run: () => exportSelectedNodes(),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const canvasExportPlugin: PluginModule = { name, inject, Config, apply }
