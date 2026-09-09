/**
 * plugin-edge-cutting —— 连接线切割插件（v2 独立包，复刻老版 canvas-core/plugins/edge-cutting）。
 *
 * 玩法：按住 Alt，在画布空白处按下左键拖拽出一道"刀光"；松手时凡是被刀光划过的真实 SVG 边路径命中删除。
 *
 * v2 铁律落地：
 * - 不 import canvas-core/src、不反向依赖宿主 demo、不碰 VueFlow 内部/宿主内部 ref。
 * - 数据删除只经 ctx.edgeStore（removeEdge）→ 宿主订阅自动刷渲染态；一次切割批量删包进
 *   ctx.history.withRecord → 整体可撤销。
 * - DOM/UI 自管：全屏 SVG overlay（刀光）由本包 EdgeCuttingOverlay 创建/清理；事件绑定在
 *   window/document/pane(整个 .vue-flow 画布)，ctx.effect 回收。
 * - 浏览器守卫：typeof window === 'undefined' 时不装配（node 装配/测试安全）。
 *
 * 边路径命中（真实 DOM，因 SVG path 需 getTotalLength/getPointAtLength 采样）：
 *   resolveEdgePath(edgeId) 用与老版一致的选择器找该边当前渲染的 <path>（v2 CustomEdge 的
 *   .edge-hit-area[data-edge-id] 优先命中）；samplePathInClientSpace 采样屏幕点；
 *   isPolylineHitByCut 判定折线相交（纯几何，geometry.ts 可单测）。
 */
import type { Context, PluginModule } from '@mini-canvas/canvas-base'
import type { EdgeStoreService, GraphDocumentService } from '@mini-canvas/canvas-core-v2'
import type { ScreenPoint } from './geometry'
import {
  DEFAULT_SAMPLE_STEP_PX,
  DEFAULT_TOLERANCE_PX,
  filterHitEdges,
  rectsOverlap,
  resolveEdgePath,
  samplePathInClientSpace,
} from './edgeCuttingCore'
import { EdgeCuttingOverlay, type BladeStyle } from './edgeCuttingOverlay'

/** 插件可调项（与老版 EdgeCuttingOptions 对齐；本轮走默认值，设置面板接线后续按需加） */
export interface EdgeCuttingOptions extends BladeStyle {
  /** 总开关 */
  enabled?: boolean
  /** 命中容差（屏幕像素） */
  tolerancePx?: number
  /** 边路径采样步长（px） */
  sampleStepPx?: number
}

/** 可编辑输入框内不启动切割（与宿主/其它插件同规则） */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

/** 命中检测输入是否落在画布区域内（.vue-flow 渲染约定，与 plugin-clipboard 同源） */
function isInsideCanvas(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('.vue-flow'))
}

/** 实现类：DOM 事件装配 + 切割会话 + overlay（apply 实例化，ctx.effect 回收） */
class EdgeCuttingController {
  private readonly overlay: EdgeCuttingOverlay
  private readonly tolerancePx: number
  private readonly sampleStepPx: number
  private altDown = false
  private cutting = false
  private points: ScreenPoint[] = []

  constructor(
    private readonly ctx: Context,
    options: EdgeCuttingOptions,
  ) {
    this.tolerancePx = options.tolerancePx ?? DEFAULT_TOLERANCE_PX
    this.sampleStepPx = options.sampleStepPx ?? DEFAULT_SAMPLE_STEP_PX
    this.overlay = new EdgeCuttingOverlay({
      pathColor: options.pathColor,
      bladeColor: options.bladeColor,
      showCutPath: options.showCutPath,
    })
  }

 private get edgeStore(): EdgeStoreService {
   return this.ctx.get<EdgeStoreService>('edgeStore')
 }
  private get graph(): GraphDocumentService {
    return this.ctx.get<GraphDocumentService>('graph')
  }

  /** 绑定全部 DOM 监听（ctx.effect 调用；返回清理函数） */
  attach(): () => void {
    if (typeof window === 'undefined') return () => {}
    this.overlay.attachResize()

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Alt' || isEditableTarget(event.target)) return
      this.altDown = true
      this.stopEvent(event)
      this.enterCuttingMode()
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== 'Alt') return
      this.altDown = false
      if (!this.cutting) this.leaveCuttingMode()
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (this.resetStaleAltMode(event)) return
      if (event.button !== 0 || !event.altKey) return
      if (isEditableTarget(event.target)) return
      if (!isInsideCanvas(event.target)) return

      this.stopEvent(event)
      this.cutting = true
      this.altDown = true
      this.points = [{ x: event.clientX, y: event.clientY }]
      this.enterCuttingMode()
      this.drawBlade()
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!this.cutting && this.resetStaleAltMode(event)) return
      if (!this.cutting) return
      this.stopEvent(event)
      this.points.push({ x: event.clientX, y: event.clientY })
      this.drawBlade()
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (!this.cutting) return
      this.stopEvent(event)
      this.cutting = false
      this.commitCut()
      this.points = []
      this.overlay.clear(160)
      if (!this.altDown) this.leaveCuttingMode()
    }
    const onWheel = (event: WheelEvent): void => {
      if (this.resetStaleAltMode(event)) return
      if (!this.altDown && !this.cutting) return
      this.stopEvent(event)
    }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') this.resetCuttingMode()
    }
    const resetAll = (): void => this.resetCuttingMode()

    // pointerdown 挂在捕获期 window：配合 isInsideCanvas 判定（不必拿 pane 引用，零耦合）
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('pointermove', onPointerMove, { capture: true })
    window.addEventListener('pointerup', onPointerUp, { capture: true })
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('blur', resetAll)
    window.addEventListener('focus', resetAll)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('pointermove', onPointerMove, { capture: true })
      window.removeEventListener('pointerup', onPointerUp, { capture: true })
      window.removeEventListener('keydown', onKeyDown, { capture: true })
      window.removeEventListener('keyup', onKeyUp, { capture: true })
      window.removeEventListener('blur', resetAll)
      window.removeEventListener('focus', resetAll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('wheel', onWheel, { capture: true })
      this.overlay.dispose()
    }
  }

  // —— 事件辅助 ——
  private stopEvent(event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    if ('stopImmediatePropagation' in event) event.stopImmediatePropagation()
  }

  private enterCuttingMode(): void {
    document.body.classList.add('edge-cutting-active')
  }
  private leaveCuttingMode(): void {
    if (this.cutting) return
    document.body.classList.remove('edge-cutting-active')
    this.overlay.clear()
  }
  private resetCuttingMode(): void {
    this.altDown = false
    this.cutting = false
    this.points = []
    document.body.classList.remove('edge-cutting-active')
    this.overlay.clear()
  }
  private resetStaleAltMode(event: Pick<MouseEvent, 'altKey'>): boolean {
    if (!this.altDown || event.altKey) return false
    this.resetCuttingMode()
    return true
  }
  private drawBlade(): void {
    this.overlay.draw(this.points, { showCutPath: true })
  }

  /** 取当前存活边里"已渲染且与视口重叠"的路径采样条目 */
  private visibleEdgeSamples(): Array<{ id: string; points: ScreenPoint[] }> {
    // F 项：取本画布实例根（viewport.getRootEl），多宿主不串线；退回全局 .vue-flow
    const vp = this.ctx.get<{ getRootEl(): HTMLElement | null } | undefined>('viewport')
    const scopeRoot = vp?.getRootEl?.() ?? null
    const canvasEl = scopeRoot ?? document.querySelector('.vue-flow')
    const viewportRect = canvasEl?.getBoundingClientRect()
    if (!viewportRect) return []

    const samples: Array<{ id: string; points: ScreenPoint[] }> = []
    for (const edge of this.edgeStore.getEdges()) {
      const path = resolveEdgePath(edge.id, scopeRoot)
      if (!path) continue
      const rect = path.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      if (!rectsOverlap(rect, viewportRect)) continue
      samples.push({ id: edge.id, points: samplePathInClientSpace(path, this.sampleStepPx) })
    }
    return samples
  }

  /** 松手结算：命中检测 → 原子删边(一次历史) → 广播事件 */
  private commitCut(): void {
    // 本轮未暴露 bladeOnlyCut：整条拖拽轨迹参与命中（与老版默认 bladeOnlyCut=false 一致）
    const cutPoints = this.points
    if (cutPoints.length < 2) return
    const entries = this.visibleEdgeSamples()
    if (entries.length === 0) return
    const hitEdgeIds = filterHitEdges(entries, cutPoints, this.tolerancePx)
    if (hitEdgeIds.length === 0) return

    // 统一走图唯一写入口：批量删边一次历史 + 自动清选中 + 提交落盘
    this.graph.removeEdges(hitEdgeIds)
   this.ctx.emit('edge-cutting:cut', { edgeIds: hitEdgeIds })
 }
}

export const name = 'edge-cutting'

export function apply(ctx: Context): void {
  const controller = new EdgeCuttingController(ctx, {})
  // ctx.effect：DOM 绑定与 overlay 全随插件 fiber 自动回收
  ctx.effect(() => controller.attach())
}

/** 兼容旧装配的 PluginModule 出口 */
export const edgeCuttingPlugin: PluginModule = { name, apply }


