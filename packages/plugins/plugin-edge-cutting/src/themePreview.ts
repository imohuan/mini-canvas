/**
 * 切割插件的「主题工作台预览层」—— 同步绘制函数。
 *
 * 复刻真实刀光：一段斜切过连线的轨迹 + 末端短尾迹 + 火花。
 * 轨迹点按预览节点的居中位置算，节点挪动时刀光跟着挪；几何用本插件的 toSmoothPathData。
 */
import type { Context } from '@plume-canvas/canvas-base'
import { THEME_PREVIEW_SLOT, type PreviewLayer, type PreviewPaintCtx } from '@plume-canvas/canvas-render'
import { toSmoothPathData, type ScreenPoint } from './edgeCuttingCore'

const SVG_NS = 'http://www.w3.org/2000/svg'

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

export const edgeCuttingPreviewLayer: PreviewLayer = {
  paint(ctx: PreviewPaintCtx): void {
    const [a, b] = ctx.nodes
    if (!a || !b) return

    const pathColor = ctx.colors('pathColor') || ctx.colors('accentHoverColor')
    const bladeColor = ctx.colors('bladeColor') || ctx.colors('accentColor')

    // 取两个端口连线的中点，在上面画一条短促斜切（不横穿整块画板）
    const from = { x: a.x + a.w, y: a.y + a.h / 2 }
    const to = { x: b.x, y: b.y + b.h / 2 }
    const midX = (from.x + to.x) / 2
    const midY = (from.y + to.y) / 2

    // 短促斜切：只跨过连线中点附近，不伸进两侧节点
    const startX = midX - 22
    const startY = midY + 22
    const endX = midX + 24
    const endY = midY - 24

    const points: ScreenPoint[] = [
      { x: startX, y: startY },
      { x: startX + 16, y: startY - 14 },
      { x: midX, y: midY },
      { x: endX - 16, y: endY + 14 },
      { x: endX, y: endY },
    ]
    const trailPoints = points.slice(-2)
    const tip = points[points.length - 1]

    const width = ctx.root.clientWidth || 720
    const height = ctx.root.clientHeight || 400

    const root = document.createElementNS(SVG_NS, 'svg')
    root.setAttribute('viewBox', '0 0 ' + width + ' ' + height)
    root.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none'

    const style = document.createElementNS(SVG_NS, 'style')
    style.textContent =
      '.pv-cut-path{fill:none;stroke:' + pathColor + ';stroke-width:1.5;stroke-opacity:.40;stroke-linecap:round;' +
      'filter:drop-shadow(0 0 2px color-mix(in srgb,' + pathColor + ' 40%,transparent))}' +
      '.pv-cut-wide{fill:none;stroke:' + bladeColor + ';stroke-width:8;stroke-opacity:.18;stroke-linecap:round;' +
      'filter:drop-shadow(0 0 5px color-mix(in srgb,' + bladeColor + ' 55%,transparent))}' +
      '.pv-cut-mid{fill:none;stroke:' + bladeColor + ';stroke-width:3;stroke-opacity:.70;stroke-linecap:round}' +
      '.pv-cut-edge{fill:none;stroke:#fff;stroke-width:1.2;stroke-linecap:round;' + // 主题色白名单: 预览层同步绘制的是画布内容快照（品牌色 / 素材色），不是界面 token
      'filter:drop-shadow(0 0 2px #fff) drop-shadow(0 0 5px ' + bladeColor + ')}' + // 主题色白名单: 预览层同步绘制的是画布内容快照（品牌色 / 素材色），不是界面 token
      '.pv-cut-spark{stroke:' + bladeColor + ';stroke-width:.9;stroke-linecap:round;opacity:.7}'
    root.appendChild(style)

    root.appendChild(svg('path', { class: 'pv-cut-path', d: toSmoothPathData(points) }))
    for (const cls of ['pv-cut-wide', 'pv-cut-mid', 'pv-cut-edge']) {
      root.appendChild(svg('path', { class: cls, d: toSmoothPathData(trailPoints) }))
    }
    root.appendChild(svg('circle', {
      class: 'pv-cut-tip', cx: String(tip.x), cy: String(tip.y), r: '3.4',
      fill: '#fff', 'fill-opacity': '0.95', stroke: bladeColor, // 主题色白名单: 预览层同步绘制的是画布内容快照（品牌色 / 素材色），不是界面 token
    }))
    root.appendChild(svg('line', {
      class: 'pv-cut-spark',
      x1: String(tip.x + 6), y1: String(tip.y - 5),
      x2: String(tip.x + 13), y2: String(tip.y - 11),
    }))
    root.appendChild(svg('line', {
      class: 'pv-cut-spark',
      x1: String(tip.x - 2), y1: String(tip.y + 7),
      x2: String(tip.x + 3), y2: String(tip.y + 12),
    }))

    ctx.el.appendChild(root)

    const label = document.createElement('span')
    label.textContent = 'Alt 划过'
    label.style.cssText =
      'position:absolute;left:' + (endX + 16) + 'px;top:' + (endY - 34) + 'px;' +
      'padding:2px 7px;border-radius:999px;background:#fff;color:#6b7280;' + // 主题色白名单: 预览层同步绘制的是画布内容快照（品牌色 / 素材色），不是界面 token
      'font-size:9px;font-weight:650;white-space:nowrap;box-shadow:0 1px 3px rgb(17 24 39 / 0.12)' // 主题色白名单: 预览层同步绘制的是画布内容快照（品牌色 / 素材色），不是界面 token
    ctx.el.appendChild(label)

    // 刀光与标签的外接框：上报后取景不会把这一侧切掉
    const xs = points.map((p) => p.x).concat([endX + 16, endX + 90])
    const ys = points.map((p) => p.y).concat([endY - 40, endY + 30])
    ctx.claim?.({
      x: Math.min(...xs) - 12,
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs) + 24,
      h: Math.max(...ys) - Math.min(...ys),
    })
  },
}

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'edge-cutting/preview',
    order: 160,
    component: edgeCuttingPreviewLayer,
    meta: { title: '切割刀光' },
  })
}
