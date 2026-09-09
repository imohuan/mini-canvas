/**
 * edge-cutting 刀光 overlay（自 v1 EdgeCuttingPlugin.ts 的样式与绘制移植）。
 *
 * 职责：全屏 fixed SVG 层 + style 标签，画"切割轨迹 + 刀锋尾迹 + 刀尖 + 火花"。
 * 纯自管 DOM（document.body 挂载/移除），与宿主/内核零耦合；插件卸载时 dispose() 清干净。
 */
import { createSvgElement, toSmoothPathData, TRAIL_POINTS, BLADE_POINTS, type ScreenPoint } from './edgeCuttingCore'

export interface BladeStyle {
  /** 完整绘制路径颜色 */
  pathColor?: string
  /** 刀锋主题色 */
  bladeColor?: string
  /** 是否显示完整拖拽轨迹（false 时只显示刀锋） */
  showCutPath?: boolean
}

/** 覆盖默认主题色的 CSS 变量 key（与 createStyle 里的 var(--...) 对应） */
function themeCssVars(style: BladeStyle): Record<string, string> {
  const vars: Record<string, string> = {}
  if (style.pathColor) vars['--edge-cutting-path-color'] = style.pathColor
  if (style.bladeColor) vars['--edge-cutting-blade-color'] = style.bladeColor
  return vars
}

function createOverlay(style: BladeStyle): SVGSVGElement {
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
  for (const [k, v] of Object.entries(themeCssVars(style))) svg.style.setProperty(k, v)
  document.body.appendChild(svg)
  syncOverlayViewport(svg)
  return svg
}

function syncOverlayViewport(svg: SVGSVGElement): void {
  const width = window.innerWidth
  const height = window.innerHeight
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
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

/** overlay 运行时句柄：创建→画帧→延迟清空→dispose */
export class EdgeCuttingOverlay {
  private svg: SVGSVGElement | null = null
  private styleEl: HTMLStyleElement | null = null
  private resizeHandler: (() => void) | null = null
  private style: BladeStyle = {}

  constructor(style: BladeStyle = {}) {
    this.style = style
  }

  /**
   * 运行时更新主题色（⚙ 设置改动后即时生效）：
   * - overlay 已建 → 就地改 inline CSS 变量，后续帧直接跟新色；
   * - 尚未创建 → 存进 this.style，待 ensure() 首建 SVG 时套用最新值。
   */
  updateStyle(style: BladeStyle): void {
    this.style = style
    if (!this.svg) return
    for (const [k, v] of Object.entries(themeCssVars(style))) this.svg.style.setProperty(k, v)
  }

  private ensure(): SVGSVGElement {
    if (!this.styleEl) this.styleEl = createStyle()
    if (!this.svg) this.svg = createOverlay(this.style)
    return this.svg
  }

  /** 窗口尺寸变化同步 viewBox */
  attachResize(): void {
    this.resizeHandler = () => {
      if (this.svg) syncOverlayViewport(this.svg)
    }
    window.addEventListener('resize', this.resizeHandler)
  }

  /** 画一帧：clear + 轨迹/刀锋/刀尖/火花 */
  draw(points: ScreenPoint[], opts: { showCutPath: boolean }): void {
    const svg = this.ensure()
    svg.replaceChildren()
    if (points.length === 0) return

    if (opts.showCutPath && points.length > 1) this.appendPath('cut-path', toSmoothPathData(points))
    const trail = points.slice(-TRAIL_POINTS)
    const blade = points.slice(-BLADE_POINTS)
    if (trail.length > 1) {
      const trailD = toSmoothPathData(trail)
      this.appendPath('blade-trail blade-trail--wide', trailD)
      this.appendPath('blade-trail blade-trail--mid', trailD)
    }
    if (blade.length > 1) this.appendPath('blade-edge', toSmoothPathData(blade))

    const last = points[points.length - 1]
    const tip = createSvgElement('circle')
    tip.setAttribute('class', 'blade-tip')
    tip.setAttribute('cx', String(last.x))
    tip.setAttribute('cy', String(last.y))
    tip.setAttribute('r', '2.2')
    svg.appendChild(tip)

    if (points.length > 2) {
      const prev = points[points.length - 2]
      this.appendSpark(prev, last, 1)
      this.appendSpark(prev, last, -1)
    }
  }

  /** 延迟清空子元素（保留 overlay 本体，便于后续复用） */
  clear(delayMs = 0): void {
    if (!this.svg) return
    if (delayMs > 0) {
      window.setTimeout(() => this.svg?.replaceChildren(), delayMs)
      return
    }
    this.svg.replaceChildren()
  }

  private appendPath(className: string, pathData: string): void {
    const path = createSvgElement('path')
    path.setAttribute('class', className)
    path.setAttribute('d', pathData)
    this.ensure().appendChild(path)
  }

  private appendSpark(from: ScreenPoint, to: ScreenPoint, rotate: 1 | -1): void {
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
    spark.setAttribute('x2', String(to.x + nx * sparkLength * rotate - (dx / length) * 3))
    spark.setAttribute('y2', String(to.y + ny * sparkLength * rotate - (dy / length) * 3))
    this.ensure().appendChild(spark)
  }

  /** 全量清理：移除 style + overlay + resize 监听（插件卸载调用） */
  dispose(): void {
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler)
      this.resizeHandler = null
    }
    this.svg?.remove()
    this.styleEl?.remove()
    this.svg = null
    this.styleEl = null
    document.body.classList.remove('edge-cutting-active')
  }
}
