import type { CanvasPlugin, PluginContext } from '../types'
import { isPolylineHitByCut, type ScreenPoint } from './geometry'

export interface EdgeCuttingOptions extends Record<string, unknown> {
  enabled?: boolean
  tolerancePx?: number
  sampleStepPx?: number
  showCutPath?: boolean
  pathColor?: string
  bladeColor?: string
  bladeOnlyCut?: boolean
}

const PLUGIN_NAME = 'edge-cutting'
const DEFAULT_TOLERANCE_PX = 8
const DEFAULT_SAMPLE_STEP_PX = 6
const DEFAULT_SHOW_CUT_PATH = true
const DEFAULT_PATH_COLOR = '#38bdf8'
const DEFAULT_BLADE_COLOR = '#38bdf8'
const DEFAULT_BLADE_ONLY_CUT = false
const TRAIL_POINTS = 12
const BLADE_POINTS = 7

function cssEscape(value: string): string {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

function toPathData(points: ScreenPoint[]): string {
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ')
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(tagName: K): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tagName)
}

function samplePathInClientSpace(path: SVGPathElement, stepPx: number): ScreenPoint[] {
  const total = path.getTotalLength()
  const matrix = path.getScreenCTM()
  if (!matrix || total <= 0) return []

  const count = Math.max(24, Math.ceil(total / stepPx))
  return Array.from({ length: count + 1 }, (_, index) => {
    const point = path.getPointAtLength((total * index) / count)
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix)
    return { x: screenPoint.x, y: screenPoint.y }
  })
}

function resolveEdgePath(edgeId: string): SVGPathElement | null {
  const escapedId = cssEscape(edgeId)
  const selectors = [
    `.edge-hit-area[data-edge-id="${escapedId}"]`,
    `.vue-flow__edge[data-id="${escapedId}"] .edge-hit-area`,
    `.vue-flow__edge-${escapedId} .edge-hit-area`,
    `[data-id="${escapedId}"] .custom-edge .edge-hit-area`,
    `.vue-flow__edge[data-id="${escapedId}"] .custom-edge path`,
    `.vue-flow__edge-${escapedId} .custom-edge path`,
  ]

  for (const selector of selectors) {
    const path = document.querySelector(selector)
    if (path instanceof SVGPathElement) return path
  }

  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function setOverlayViewport(svg: SVGSVGElement): void {
  const width = window.innerWidth
  const height = window.innerHeight
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
}

function createOverlay(): SVGSVGElement {
  const svg = createSvgElement('svg')
  svg.classList.add('edge-cutting-overlay')
  svg.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100vw',
    'height:100vh',
    'overflow:visible',
    'pointer-events:none',
    'z-index:10000',
  ].join(';')
  setOverlayViewport(svg)
  document.body.appendChild(svg)
  return svg
}

function createStyle(): HTMLStyleElement {
  const style = document.createElement('style')
  style.textContent = `
.edge-cutting-overlay .cut-path {
  fill: none;
  stroke: var(--edge-cutting-path-color, #38bdf8);
  stroke-width: 1.1;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-opacity: 0.42;
  mix-blend-mode: screen;
  filter: drop-shadow(0 0 2px var(--edge-cutting-path-color, #38bdf8));
}
.edge-cutting-overlay .blade-trail {
  fill: none;
  stroke: var(--edge-cutting-blade-color, #38bdf8);
  stroke-linecap: round;
  stroke-linejoin: round;
  mix-blend-mode: screen;
  filter: drop-shadow(0 0 3px var(--edge-cutting-blade-color, #38bdf8));
}
.edge-cutting-overlay .blade-trail--wide {
  stroke-opacity: 0.13;
  stroke-width: 5;
}
.edge-cutting-overlay .blade-trail--mid {
  stroke-opacity: 0.34;
  stroke-width: 2.4;
}
.edge-cutting-overlay .blade-edge {
  fill: none;
  stroke: #ffffff;
  stroke-width: 1.2;
  stroke-linecap: round;
  stroke-linejoin: round;
  mix-blend-mode: screen;
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.8)) drop-shadow(0 0 4px var(--edge-cutting-blade-color, #38bdf8));
}
.edge-cutting-overlay .blade-tip {
  fill: rgba(255, 255, 255, 0.88);
  stroke: var(--edge-cutting-blade-color, #38bdf8);
  stroke-width: 0.8;
  stroke-opacity: 0.5;
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.68));
}
.edge-cutting-overlay .blade-spark {
  stroke: #ffffff;
  stroke-width: 0.8;
  stroke-linecap: round;
  opacity: 0.55;
  filter: drop-shadow(0 0 2px var(--edge-cutting-blade-color, #38bdf8));
}
body.edge-cutting-active {
  cursor: crosshair;
}
`
  document.head.appendChild(style)
  return style
}

export const EdgeCuttingPlugin: CanvasPlugin<EdgeCuttingOptions> = {
  name: PLUGIN_NAME,
  version: '0.1.0',
  options: {
    enabled: true,
    tolerancePx: DEFAULT_TOLERANCE_PX,
    sampleStepPx: DEFAULT_SAMPLE_STEP_PX,
    showCutPath: DEFAULT_SHOW_CUT_PATH,
    pathColor: DEFAULT_PATH_COLOR,
    bladeColor: DEFAULT_BLADE_COLOR,
    bladeOnlyCut: DEFAULT_BLADE_ONLY_CUT,
  },

  install(context: PluginContext, options: EdgeCuttingOptions = {}) {
    context.panels.registerSetting(PLUGIN_NAME, {
      id: 'edge-cutting.enabled',
      source: PLUGIN_NAME,
      title: '启用连接线切割',
      description: '按住 Alt 拖拽刀光切割连接线',
      type: 'boolean',
      group: '连接线',
      order: 52,
      defaultValue: options.enabled ?? true,
    })
    context.panels.registerSetting(PLUGIN_NAME, {
      id: 'edge-cutting.tolerancePx',
      source: PLUGIN_NAME,
      title: '切割容差',
      description: '屏幕像素，越大越容易切中连接线',
      type: 'slider',
      group: '连接线',
      order: 53,
      defaultValue: options.tolerancePx ?? DEFAULT_TOLERANCE_PX,
      min: 2,
      max: 24,
      step: 1,
    })
    context.panels.registerSetting(PLUGIN_NAME, {
      id: 'edge-cutting.showCutPath',
      source: PLUGIN_NAME,
      title: '显示绘制路径',
      description: '显示完整拖拽轨迹，刀锋效果仍保持短而细',
      type: 'boolean',
      group: '连接线',
      order: 54,
      defaultValue: options.showCutPath ?? DEFAULT_SHOW_CUT_PATH,
    })
    context.panels.registerSetting(PLUGIN_NAME, {
      id: 'edge-cutting.pathColor',
      source: PLUGIN_NAME,
      title: '绘制路径颜色',
      description: '完整拖拽轨迹的显示颜色',
      type: 'color',
      group: '连接线',
      order: 55,
      defaultValue: options.pathColor ?? DEFAULT_PATH_COLOR,
    })
    context.panels.registerSetting(PLUGIN_NAME, {
      id: 'edge-cutting.bladeColor',
      source: PLUGIN_NAME,
      title: '刀锋主题色',
      description: '刀锋光晕、刀尖和主题高光颜色',
      type: 'color',
      group: '连接线',
      order: 56,
      defaultValue: options.bladeColor ?? DEFAULT_BLADE_COLOR,
    })
    context.panels.registerSetting(PLUGIN_NAME, {
      id: 'edge-cutting.bladeOnlyCut',
      source: PLUGIN_NAME,
      title: '仅刀锋路径裁剪',
      description: '开启后只有当前可见刀锋参与切割，完整绘制路径只用于显示',
      type: 'boolean',
      group: '连接线',
      order: 57,
      defaultValue: options.bladeOnlyCut ?? DEFAULT_BLADE_ONLY_CUT,
    })

    const enabledRef = context.store.toRef('enabled', options.enabled ?? true)
    const toleranceRef = context.store.toRef('tolerancePx', options.tolerancePx ?? DEFAULT_TOLERANCE_PX)
    const showCutPathRef = context.store.toRef('showCutPath', options.showCutPath ?? DEFAULT_SHOW_CUT_PATH)
    const pathColorRef = context.store.toRef('pathColor', options.pathColor ?? DEFAULT_PATH_COLOR)
    const bladeColorRef = context.store.toRef('bladeColor', options.bladeColor ?? DEFAULT_BLADE_COLOR)
    const bladeOnlyCutRef = context.store.toRef('bladeOnlyCut', options.bladeOnlyCut ?? DEFAULT_BLADE_ONLY_CUT)
    const sampleStepPx = options.sampleStepPx ?? DEFAULT_SAMPLE_STEP_PX

    let overlay: SVGSVGElement | null = null
    let styleEl: HTMLStyleElement | null = null
    let altDown = false
    let cutting = false
    let points: ScreenPoint[] = []

    function syncOverlayTheme(svg: SVGSVGElement): void {
      svg.style.setProperty('--edge-cutting-path-color', String(pathColorRef.value))
      svg.style.setProperty('--edge-cutting-blade-color', String(bladeColorRef.value))
    }

    function ensureOverlay(): SVGSVGElement {
      if (!styleEl) styleEl = createStyle()
      if (!overlay) overlay = createOverlay()
      setOverlayViewport(overlay)
      syncOverlayTheme(overlay)
      return overlay
    }

    function clearOverlay(delay = 0): void {
      if (!overlay) return
      if (delay > 0) {
        window.setTimeout(() => { overlay?.replaceChildren() }, delay)
        return
      }
      overlay.replaceChildren()
    }

    function appendPath(className: string, pathData: string): void {
      const svg = ensureOverlay()
      const path = createSvgElement('path')
      path.setAttribute('class', className)
      path.setAttribute('d', pathData)
      svg.appendChild(path)
    }

    function appendSpark(from: ScreenPoint, to: ScreenPoint, rotate: 1 | -1): void {
      const svg = ensureOverlay()
      const dx = to.x - from.x
      const dy = to.y - from.y
      const length = Math.hypot(dx, dy) || 1
      const nx = -dy / length
      const ny = dx / length
      const sparkLength = 7
      const spark = createSvgElement('line')
      spark.setAttribute('class', 'blade-spark')
      spark.setAttribute('x1', String(to.x + nx * 1.6 * rotate))
      spark.setAttribute('y1', String(to.y + ny * 1.6 * rotate))
      spark.setAttribute('x2', String(to.x + nx * sparkLength * rotate - dx / length * 3))
      spark.setAttribute('y2', String(to.y + ny * sparkLength * rotate - dy / length * 3))
      svg.appendChild(spark)
    }

    function drawBlade(): void {
      const svg = ensureOverlay()
      svg.replaceChildren()
      if (points.length === 0) return

      const cutPath = toPathData(points)
      const trailPath = toPathData(points.slice(-TRAIL_POINTS))
      const bladePath = toPathData(points.slice(-BLADE_POINTS))
      if (showCutPathRef.value && points.length > 1) appendPath('cut-path', cutPath)
      appendPath('blade-trail blade-trail--wide', trailPath)
      appendPath('blade-trail blade-trail--mid', trailPath)
      appendPath('blade-edge', bladePath)

      const lastPoint = points[points.length - 1]
      const prevPoint = points[points.length - 2] ?? lastPoint
      const tip = createSvgElement('circle')
      tip.setAttribute('class', 'blade-tip')
      tip.setAttribute('cx', String(lastPoint.x))
      tip.setAttribute('cy', String(lastPoint.y))
      tip.setAttribute('r', '2.2')
      svg.appendChild(tip)

      if (points.length > 2) {
        appendSpark(prevPoint, lastPoint, 1)
        appendSpark(prevPoint, lastPoint, -1)
      }
    }

    function visibleEdgePathEntries(): Array<{ id: string; path: SVGPathElement }> {
      const viewportRect = context.dom.getPane()?.getBoundingClientRect()
        ?? document.querySelector('.vue-flow')?.getBoundingClientRect()
      if (!viewportRect) return []

      const entries: Array<{ id: string; path: SVGPathElement }> = []
      for (const edge of context.actions.getEdges()) {
        if (edge.data?.isTemp) continue
        const path = resolveEdgePath(edge.id)
        if (!path) continue
        const rect = path.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) continue
        if (!rectsOverlap(rect, viewportRect)) continue
        entries.push({ id: edge.id, path })
      }
      return entries
    }

    function commitCut(): void {
      const cutPoints = bladeOnlyCutRef.value ? points.slice(-BLADE_POINTS) : points
      if (cutPoints.length < 2) return
      const hitEdgeIds = visibleEdgePathEntries()
        .filter(({ path }) => {
          const edgePoints = samplePathInClientSpace(path, sampleStepPx)
          return isPolylineHitByCut(edgePoints, cutPoints, toleranceRef.value)
        })
        .map(({ id }) => id)

      if (hitEdgeIds.length > 0) {
        context.actions.removeEdges(hitEdgeIds)
        context.emit('edge-cutting:cut', { edgeIds: hitEdgeIds })
      }
    }

    function stopNativeCanvasInput(event: Event): void {
      event.preventDefault()
      event.stopPropagation()
      if ('stopImmediatePropagation' in event) event.stopImmediatePropagation()
    }

    function enterCuttingMode(): void {
      document.body.classList.add('edge-cutting-active')
      ensureOverlay()
    }

    function leaveCuttingMode(): void {
      if (cutting) return
      document.body.classList.remove('edge-cutting-active')
      clearOverlay()
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Alt' || isEditableTarget(event.target) || !enabledRef.value) return
      altDown = true
      stopNativeCanvasInput(event)
      enterCuttingMode()
    }

    function onKeyUp(event: KeyboardEvent): void {
      if (event.key !== 'Alt') return
      altDown = false
      if (!cutting) leaveCuttingMode()
    }

    function onPointerDown(event: PointerEvent): void {
      if (!enabledRef.value || event.button !== 0 || (!altDown && !event.altKey)) return
      if (isEditableTarget(event.target)) return

      stopNativeCanvasInput(event)
      cutting = true
      altDown = true
      points = [{ x: event.clientX, y: event.clientY }]
      enterCuttingMode()
      drawBlade()
    }

    function onPointerMove(event: PointerEvent): void {
      if (!cutting) return
      stopNativeCanvasInput(event)
      points.push({ x: event.clientX, y: event.clientY })
      drawBlade()
    }

    function onPointerUp(event: PointerEvent): void {
      if (!cutting) return
      stopNativeCanvasInput(event)
      cutting = false
      commitCut()
      points = []
      clearOverlay(160)
      if (!altDown) leaveCuttingMode()
    }

    function onWheel(event: WheelEvent): void {
      if (!enabledRef.value || (!altDown && !cutting)) return
      stopNativeCanvasInput(event)
    }

    const onPointerDownListener: EventListener = (event) => {
      if (event instanceof PointerEvent) onPointerDown(event)
    }
    const onResize = () => { if (overlay) setOverlayViewport(overlay) }

    const pane = context.dom.getPane()
    const eventTarget = pane ?? document
    eventTarget.addEventListener('pointerdown', onPointerDownListener, { capture: true })
    window.addEventListener('pointermove', onPointerMove, { capture: true })
    window.addEventListener('pointerup', onPointerUp, { capture: true })
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    window.addEventListener('resize', onResize)
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })

    context.logger.info('[EdgeCutting] 就绪：按住 Alt 拖拽刀光切割连接线')

    return {
      uninstall() {
        eventTarget.removeEventListener('pointerdown', onPointerDownListener, { capture: true })
        window.removeEventListener('pointermove', onPointerMove, { capture: true })
        window.removeEventListener('pointerup', onPointerUp, { capture: true })
        window.removeEventListener('keydown', onKeyDown, { capture: true })
        window.removeEventListener('keyup', onKeyUp, { capture: true })
        window.removeEventListener('resize', onResize)
        window.removeEventListener('wheel', onWheel, { capture: true })
        document.body.classList.remove('edge-cutting-active')
        overlay?.remove()
        styleEl?.remove()
        overlay = null
        styleEl = null
      },
    }
  },
}