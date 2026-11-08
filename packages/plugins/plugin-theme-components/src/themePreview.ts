/**
 * 默认主题的「主题工作台预览层」—— 一个同步绘制函数，不是 Vue 组件。
 *
 * 画的是主题自己拥有的东西：节点壳、连线、端口、按钮与状态色。
 * 坐标全部来自宿主传进来的 nodes；节点被文字撑高时，宿主量完再调用，
 * 端口和连线端点因此始终贴着卡片。
 *
 * 复用同一套语义：颜色读主题色板（readPreviewColor），连线几何用 buildEdgePath，
 * 节点内的按钮用 shadcn Button 的同一套 token（这里手写 DOM，避免预览依赖 VueFlow）。
 */
import type { Context } from '@mini-canvas/canvas-base'
import { THEME_PREVIEW_SLOT, type PreviewLayer, type PreviewNodeRect, type PreviewPaintCtx } from '@mini-canvas/canvas-render'
import { buildEdgePath, Position } from '@mini-canvas/theme-contract'

const SVG_NS = 'http://www.w3.org/2000/svg'

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  return node
}

function svg(tag: string, attrs: Record<string, string>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

function rectStyle(node: PreviewNodeRect): string {
  return 'position:absolute;box-sizing:border-box;' +
    'left:' + node.x + 'px;top:' + node.y + 'px;width:' + node.w + 'px;height:' + node.h + 'px'
}

/** 节点标题：放在卡片上缘外侧（与真实节点同一位置语义）。 */
function paintTitle(card: HTMLElement, node: PreviewNodeRect, accent: string, ink: string): void {
  const title = el('div', 'pv-node-title')
  title.textContent = node.title || node.kind || '节点'
  title.style.cssText =
    'position:absolute;left:-1px;bottom:calc(100% + 7px);display:flex;align-items:center;gap:5px;' +
    'max-width:calc(100% + 2px);color:' + ink + ';font-size:12px;font-weight:650;white-space:nowrap'
  const dot = el('i', '')
  dot.style.cssText = 'width:5px;height:5px;border-radius:99px;background:' + accent
  title.prepend(dot)
  if (node.kind) {
    const tag = el('em', '')
    tag.textContent = node.kind === 'text' ? '文本' : node.kind === 'image' ? '图片' : node.kind
    tag.style.cssText =
      'margin-left:auto;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,' + accent + ' 12%,transparent);' +
      'color:' + accent + ';font-size:8px;font-style:normal;font-weight:700'
    title.appendChild(tag)
  }
  card.appendChild(title)
}

function paintPorts(card: HTMLElement, accent: string, surface: string): void {
  for (const side of ['l', 'r'] as const) {
    const port = el('span', 'pv-port')
    port.style.cssText =
      'position:absolute;top:50%;width:8px;height:8px;border:2px solid ' + accent + ';border-radius:99px;' +
      'background:' + surface + ';transform:translateY(-50%);' + (side === 'l' ? 'left:-4px' : 'right:-4px')
    card.appendChild(port)
  }
}

/** 节点 A：文本卡片，按钮全部在卡片内部。 */
function paintTextCard(
  card: HTMLElement,
  accent: string,
  hover: string,
  danger: string,
  warn: string,
  ink: string,
  surface: string,
): void {
  const body = el('div', '')
  body.style.cssText = 'display:flex;height:100%;flex-direction:column;justify-content:flex-start;gap:10px;padding:13px 14px 12px;overflow:hidden'

  const text = el('p', '')
  text.textContent = '把碎片想法收进来，再用连线整理。'
  text.style.cssText = 'margin:0;color:' + ink + ';font-size:12px;line-height:1.6;flex:0 0 auto'
  body.appendChild(text)

  const actions = el('div', '')
  actions.style.cssText =
    'display:flex;flex-wrap:wrap;align-items:center;align-content:flex-start;gap:5px;margin-top:auto'

  const makeBtn = (label: string, kind: 'primary' | 'hover' | 'ghost' | 'danger' | 'warn' | 'disabled'): HTMLElement => {
    const btn = el('button', 'pv-btn')
    btn.type = 'button'
    btn.textContent = label
    const base =
      'display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;height:25px;padding:0 9px;' +
      'border:1px solid transparent;border-radius:7px;font:inherit;font-size:10px;font-weight:650;' +
      'line-height:1;white-space:nowrap;cursor:default'
    const styles: Record<string, string> = {
      primary: 'background:' + accent + ';color:#fff;box-shadow:0 1px 2px color-mix(in srgb,' + accent + ' 35%,transparent)',
      hover: 'border-color:' + hover + ';background:' + hover + ';color:#fff',
      ghost: 'border-color:#e2e5ea;background:' + surface + ';color:' + ink,
      danger: 'border-color:' + danger + ';background:color-mix(in srgb,' + danger + ' 10%,transparent);color:' + danger,
      warn: 'border-color:' + warn + ';background:color-mix(in srgb,' + warn + ' 14%,transparent);color:#9a6114',
      disabled: 'border-color:#e2e5ea;background:#f6f7f9;color:#b3b9c2',
    }
    btn.style.cssText = base + ';' + styles[kind]
    if (kind === 'disabled') btn.disabled = true
    return btn
  }

  for (const [label, kind] of [
    ['生成', 'primary'],
    ['悬停', 'hover'],
    ['删除', 'danger'],
    ['待确认', 'warn'],
    ['不可用', 'disabled'],
  ] as const) {
    actions.appendChild(makeBtn(label, kind))
  }

  // 色板小圆点：把连线 / 流光 / 强调 / 刀锋四个颜色放在按钮行末尾
  const swatches = el('span', '')
  swatches.style.cssText = 'display:inline-flex;align-items:center;gap:2px;margin-left:auto'
  for (const color of [accent, '#22d3ee', accent, '#fbbf24']) {
    const dot = el('i', '')
    dot.style.cssText = 'width:8px;height:8px;border-radius:2px;box-shadow:inset 0 0 0 1px rgb(0 0 0 / 0.10);background:' + color
    swatches.appendChild(dot)
  }
  actions.appendChild(swatches)

  body.appendChild(actions)
  card.appendChild(body)
}

/** 节点 B：图片卡片，只放图片与提示，不放按钮。 */
function paintImageCard(card: HTMLElement, node: PreviewNodeRect, accent: string): void {
  const body = el('div', '')
  body.style.cssText = 'position:absolute;inset:0;padding:10px 11px'

  const art = el('div', '')
  art.style.cssText =
    'position:relative;width:100%;height:100%;overflow:hidden;border-radius:7px;' +
    'background:linear-gradient(135deg,' + accent + ',#22d3ee 60%,#a5f3fc)'
  const caption = el('span', '')
  caption.textContent = '拖入图片开始'
  caption.style.cssText =
    'position:absolute;left:9px;bottom:9px;padding:3px 8px;border-radius:5px;background:rgb(15 23 42 / 0.30);' +
    'color:#fff;font-size:10px;font-weight:650;backdrop-filter:blur(4px)'
  art.appendChild(caption)
  body.appendChild(art)
  card.appendChild(body)
}

/** 画一条连线：导轨 + 流光 + 箭头。 */
function paintEdge(svgEl: SVGSVGElement, a: PreviewNodeRect, b: PreviewNodeRect, rail: string, flow: string, motion: boolean): void {
  const from = { x: a.x + a.w, y: a.y + a.h / 2 }
  const to = { x: b.x, y: b.y + b.h / 2 }
  const d = buildEdgePath(from.x, from.y, to.x, to.y, Position.Right, Position.Left, 'bezier', {
    minCurvature: 40,
  })

  const styleText = document.createElementNS(SVG_NS, 'style')
  styleText.textContent =
    '.pv-wire-glow{fill:none;stroke:' + flow + ';stroke-width:7;opacity:.12;filter:blur(3px)}' +
    '.pv-wire-rail{fill:none;stroke:' + rail + ';stroke-width:1.8;opacity:.85;stroke-linecap:round}' +
    '.pv-wire-flow{fill:none;stroke:' + flow + ';stroke-width:2.6;stroke-dasharray:3 11;stroke-linecap:round;' +
    'filter:drop-shadow(0 0 3px ' + flow + ');' +
    (motion ? 'animation:pv-flow 2.6s linear infinite' : '') + '}' +
    '@keyframes pv-flow{to{stroke-dashoffset:-28}}'
  svgEl.appendChild(styleText)

  for (const cls of ['pv-wire-glow', 'pv-wire-rail', 'pv-wire-flow']) {
    svgEl.appendChild(svg('path', { class: cls, d }))
  }

  const arrow = svg('path', {
    d: 'M ' + (to.x - 1) + ' ' + to.y + ' L ' + (to.x - 11) + ' ' + (to.y - 4.4) +
      ' L ' + (to.x - 11) + ' ' + (to.y + 4.4) + ' Z',
    fill: rail,
  })
  svgEl.appendChild(arrow)
}

/** 默认主题在预览里的绘制层。 */
export const themePreviewLayer: PreviewLayer = {
  paint(ctx: PreviewPaintCtx): void {
    const accent = ctx.colors('accentColor')
    const hover = ctx.colors('accentHoverColor') || accent
    const danger = ctx.colors('dangerColor')
    const warn = ctx.colors('warnColor')
    const rail = ctx.colors('edgeRailColor')
    const flow = ctx.colors('edgeFlowColor') || accent

    // 节点表面与文字色：亮暗两套，跟着样张模式走（不是整站主题）
    const dark = ctx.mode === 'dark'
    const surface = dark ? '#252525' : '#ffffff'
    const border = dark ? '#3a3a3a' : '#e5e7eb'
    const ink = dark ? '#e8e8e8' : '#374151'
    const titleInk = dark ? '#f2f2f2' : '#111827'
    const shadow = dark ? 'rgb(0 0 0 / 0.45)' : 'rgb(17 24 39 / 0.09)'

    const stage = el('div', '')
    stage.style.cssText = 'position:absolute;inset:0'

    // 连线先画，压在节点下面
    const wires = document.createElementNS(SVG_NS, 'svg')
    wires.setAttribute('viewBox', '0 0 ' + ctx.root.clientWidth + ' ' + ctx.root.clientHeight)
    wires.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible'
    const nodes = ctx.nodes
    if (nodes.length >= 2) {
      paintEdge(wires, nodes[0], nodes[1], rail, flow, ctx.motion)
    }
    stage.appendChild(wires)

    for (const node of nodes) {
      const card = el('div', 'pv-node')
      card.style.cssText =
        rectStyle(node) +
        ';border:1px solid ' + border + ';border-radius:10px;background:' + surface +
        ';box-shadow:0 2px 10px ' + shadow
      paintTitle(card, node, accent, titleInk)
      if (node.kind === 'image') paintImageCard(card, node, accent)
      else paintTextCard(card, accent, hover, danger, warn, ink, surface)
      paintPorts(card, accent, surface)
      stage.appendChild(card)

      // 卡片本体 + 上方的标题条 + 端口外扩：如实上报，取景才不会被裁。
      // 上沿不能报负数（会把取景范围推到画板外，画面被顶偏）。
      const top = Math.max(0, node.y - 26)
      const bottom = node.y + node.h + 6
      ctx.claim?.({
        x: Math.max(0, node.x - 6),
        y: top,
        w: node.w + 12,
        h: Math.max(0, bottom - top),
      })
    }

    ctx.el.appendChild(stage)
  },
}

export function registerThemePreview(ctx: Context): void {
  ctx.slots.register(THEME_PREVIEW_SLOT, {
    id: 'theme-components/preview',
    order: 100,
    component: themePreviewLayer,
    meta: { title: '节点与连线' },
  })
}
