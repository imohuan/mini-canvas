/**
 * plugin-canvas-export —— 画布导出 PNG 插件（cordis 写法，纯逻辑无 Vue、纯消费方、不对外提供服务）。
 *
 * 复刻老版 packages/canvas-core/src/plugins/canvas-export（CanvasExportPlugin），
 * 并解决一个核心问题：老实现导出的图会跟着用户当时的画布缩放走（缩到 0.2 导出就糊，放到 2 导出就虚胖）。
 *
 * ## 为什么要重写导出方式
 * 老实现把 .vue-flow__viewport 整个交给 html-to-image——那个元素只有「窗口那么大」，而且 CSS 是 overflow:clip。
 * 于是导出图 = 当前视口那一小块，并且里面一切都带着当时的缩放。
 *
 * 本插件的做法：**导出时临时把画布切到 zoom=1，分块取景，最后拼成一整张图**。
 *   1. 先算「要导出哪块区域」（flow 绝对坐标）：全画布内容 或 选中节点包围盒（见 exportGeometry.planExport）；
 *   2. 按可视区尺寸把该区域切成若干块（tile）；
 *   3. 每块把视口平移，使「该块左上角」对齐到容器原点，此时按 zoom=1 拍一张 = 该块的 1:1 画面；
 *   4. 把每张块图贴到大画布的对应位置；全部贴完 = 一整张 zoom=1 的高清图；
 *   5. finally 把视口原样还原（用户几乎看不出闪动；程序化 setViewport 不触发落盘，理由见下）。
 *
 * ## 节点很多为什么也不卡
 * 每块取景时用 html-to-image 的 filter 跳过「不在本块里的节点/连线」，克隆成本只与**块内元素数**成正比，
 * 不再与全图元素数成正比。所以 500 个节点不会变成 500 份克隆，每块只克隆自己那几颗。
 * （filter 回调收到的是**原始 DOM 节点**，所以按 data-id 判断成员即可。）
 *
 * ## 跨块元素（交叉情况）为什么能拼严
 * 相邻块拍的是**同一份 DOM 的同一片内容**，只是平移不同。
 * 跨块边界的节点/连线在左块画一半、右块画另一半，贴回去天然严丝合缝——不需要每块都把跨块元素完整画一遍。
 * 真正的关键只有两条，都在 exportGeometry 里：
 *   - 块坐标/贴图偏移必须是**整数像素**（roundRectOutward + 整数块尺寸），否则拼缝会出现半像素模糊线；
 *   - 判定「这块要不要这个元素」时给元素框**外扩余量**（NODE_TILE_MARGIN / EDGE_TILE_MARGIN），
 *     否则跨边界的阴影/光晕/曲线外扩会被切出一条硬边。
 *
 * ## 背景
 * .vue-flow__viewport **不包含**背景（主题 DefaultBackground 挂在 VueFlow 默认插槽，是它的兄弟节点）。
 * 所以背景由本插件自己在输出画布上按 flow 坐标画（底色 + 圆点网格，参数对齐 DefaultBackground 在 zoom=1 时的取值），
 * 这样分块拼出来也完全连续。是否画背景、底色、点色都可在设置面板调。
 *
 * ## 视口落盘（隐藏坑，已核对 VueFlow 1.48 源码）
 * d3-zoom 的 start/end 回调都有 if (!event.sourceEvent) return null，而 setViewport（无 duration）走的是程序化
 * transform、不带 sourceEvent → **不触发 moveEnd** → CanvasHost 的 persistViewport 不会把临时视口写进存档。
 * 所以用户刷新后画布位置不会被弄脏。
 *
 * ## 与 v1 差异（适配 v2 架构）
 * - 快捷键不走 registerShortcut，改用命令 keys（'mod+e' / 'mod+shift+e'），由渲染层 CanvasHost keydown 统一分发。
 * - 无 DOM / 无选中不弹 alert：命令内 console.warn + 直接 return。
 * - 读选中用 ctx.selection.ids，不 import 任何 render/core 内部 .vue。
 * - 命令 id 与 'canvas-export:exported' 事件 payload 保持与旧版一致（{type:'full'} / {type:'selected', count}）。
 */
import type {
  PluginModule,
  Context,
  ConfigSchema,
  InferConfig,
} from '@mini-canvas/canvas-base'
import type { SelectionService } from '@mini-canvas/canvas-core-v2'
import { isTransient } from '@mini-canvas/canvas-core-v2'
import { getFontEmbedCSS, toCanvas } from 'html-to-image'
import {
  EXPORT_SCALE_DEFAULT,
  EXPORT_SCALE_MAX,
  EXPORT_SCALE_MIN,
  MAX_BG_DOTS,
  MAX_EXPORT_TILES,
  LARGE_EXPORT_TILES,
  backgroundGridStep,
  clampScaleForPane,
  exceedsMaxDimension,
  fitScale,
  keepExportElement,
  outputSize,
  planExport,
  planTiles,
  roundRectOutward,
  tileEdgeIds,
  tileNodeIds,
  visibleRectInFlow,
  type NodeRect,
  type Rect,
} from './exportGeometry'

/** 类型增强缝：宿主「恒在服务」上 ctx.selection 直访（与 plugin-canvas-commands 同款写法） */
declare module '@mini-canvas/canvas-core-v2' {
  interface Context {
    selection: SelectionService
  }
}

export const name = 'canvas-export'
export const inject = ['selection'] as string[]

/** 背景网格参数：与主题 plugin-theme-default 的 DefaultBackground 在 zoom=1 时一致（GRID=24、DOT_R=1.6） */
const BG_GRID = 24
const BG_DOT_R = 1.6

/** P4 模块级 Config schema：导出相关可调项（改设置面板即时生效，导出时实时读）。 */
export const Config: ConfigSchema = {
  exportSelectedRectPadding: {
    type: 'number',
    default: 4,
    min: 0,
    max: 64,
    step: 1,
    label: '导出边缘留白',
    group: '导出',
    description: '导出图在内容四周额外留出的像素（默认 4，避免边缘的阴影/光晕被切掉）。',
  },
  exportScale: {
    type: 'number',
    default: EXPORT_SCALE_DEFAULT,
    min: EXPORT_SCALE_MIN,
    max: EXPORT_SCALE_MAX,
    step: 1,
    label: '清晰度倍数',
    group: '导出',
    description: '导出图的像素密度（1 = 与画面 1:1，2 = 两倍更清晰）。内容过大时会自动降到能装下的倍数。',
  },
  exportBackground: {
    type: 'boolean',
    default: true,
    label: '导出背景',
    group: '导出',
    description: '导出图上是否画画布背景（底色 + 圆点网格）。关闭则背景透明。',
  },
  exportBackgroundColor: {
    type: 'color',
    default: '#f8fafc',
    label: '背景颜色',
    group: '导出',
    description: '导出图的背景底色（仅在「导出背景」打开时生效）。',
  },
  exportDotColor: {
    type: 'color',
    default: '#cbd5e1',
    label: '背景网格点颜色',
    group: '导出',
    description: '导出图背景圆点网格的颜色（仅在「导出背景」打开时生效）。',
  },
}

/** apply 收到的 config TS 类型（与 schema 对齐） */
export interface CanvasExportConfig extends InferConfig<typeof Config> {}

/** 导出类型（与旧版事件 payload 对齐） */
type ExportType = 'full' | 'selected'

// ==================== 宿主注入服务的最小结构（只声明用到的部分，不新增依赖） ====================

interface ViewportPort {
  getViewport(): { x: number; y: number; zoom: number }
  setViewport(v: { x: number; y: number; zoom: number }): void
  getRootEl?(): HTMLElement | null
  getRendererEl?(): HTMLElement | null
}

interface NodeLayoutPort {
  getAllRects(): NodeRect[]
}

interface NodeStorePort {
  getNodes(): Array<{ id: string; data?: Record<string, unknown> }>
}

interface EdgeStorePort {
  getEdges(): Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>
}

interface SettingsPort {
  get(key: string): string | number | boolean | undefined
}

// ==================== DOM 工具 ====================

/** 取当前画布视口 DOM（VueFlow 渲染约定：整张画布内容在 .vue-flow__viewport 内）。 */
function getFlowEl(ctx: Context): HTMLElement | null {
  const vp = ctx.get<ViewportPort | undefined>('viewport')
  const root = vp?.getRootEl?.() ?? null
  const renderer = vp?.getRendererEl?.() ?? null
  const flowViewport = root?.querySelector<HTMLElement>('.vue-flow__viewport') ?? null
  if (flowViewport) return flowViewport
  return renderer ?? null
}

/** 主题调试可视化容器的类名（导出时经 html-to-image filter 剔除；与 plugin-theme-default 约定） */
const DEBUG_OVERLAY_CLASSES = [
  'moving-handle-debug',
  'v2-debug-overlay',
  'port-follow-zone',
  'moving-handle-button',
]

/**
 * 造一次导出的 filter：跳过调试叠加 + 跳过「本次不进图」的节点/连线。
 *
 * 关键：html-to-image 的 filter 收到的是**原始 DOM 节点**（不是克隆体），所以能直接按 data-id 判成员。
 * 这样「隐藏其他不相关的节点和连接线」是在**克隆阶段**完成的：真实 DOM 一动不动，
 * 用户不会看到闪烁，也不需要导出后恢复显隐。
 *
 * 取舍规则本身在 exportGeometry.keepExportElement（纯函数，含「连线要按 <svg> 外壳判」这个坑），
 * 这里只负责把 DOM 上的信息读出来喂给它。
 */
function makeExportFilter(keepNodes: ReadonlySet<string>, keepEdges: ReadonlySet<string>) {
  return (node: HTMLElement): boolean => {
    const cls = node.classList
    if (!cls || typeof cls.contains !== 'function') return true
    const isEdgeShell = cls.contains('vue-flow__edges')
    const innerEdge = isEdgeShell
      ? node.querySelector(':scope > g.vue-flow__edge[data-id]')
      : null
    return keepExportElement({
      classes: Array.from(cls),
      dataId: node.getAttribute('data-id'),
      innerEdgeId: innerEdge?.getAttribute('data-id') ?? null,
      debugClasses: DEBUG_OVERLAY_CLASSES,
      keepNodes,
      keepEdges,
    })
  }
}

/** 等浏览器画完一帧（临时改视口后，等 Vue 把新 transform 刷进 DOM 再截图） */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** 触发浏览器下载一个 dataURL 为 png 文件 */
function downloadPng(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.download = filename
  link.href = dataUrl
  link.click()
}

/** 导出期间需要遮住画布：分块时视口会临时跳到 zoom=1，块多时肉眼可见，必须挡住不让用户看到跳动 */
const OVERLAY_STYLE_ID = 'canvas-export-overlay-style'
const OVERLAY_ANIM = 'canvas-export-pulse'

/** 注入遮罩样式（幂等；含 prefers-reduced-motion 降级，遵循项目 UI 规范的等待态约定） */
function ensureOverlayStyle(): void {
  if (document.getElementById(OVERLAY_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = OVERLAY_STYLE_ID
  style.textContent =
    '@keyframes ' + OVERLAY_ANIM + ' {' +
    '0%{box-shadow:0 0 0 0 rgba(8,145,178,0.45)}' +
    '70%{box-shadow:0 0 0 8px rgba(8,145,178,0)}' +
    '100%{box-shadow:0 0 0 0 rgba(8,145,178,0)}' +
    '}' +
    '@media (prefers-reduced-motion: reduce){.canvas-export-ring{animation:none!important}}'
  document.head.appendChild(style)
}

/**
 * 罩住画布的导出遮罩（盖在画布矩形上，阻止交互 + 显示进度）。
 * 数值取自 docs/design/ui-style-guide.md：遮罩渐变、面板圆角 16、e2 阴影、青色等待脉冲环。
 */
function showExportOverlay(target: HTMLElement | null): { el: HTMLElement; progress: (done: number, total: number) => void } {
  ensureOverlayStyle()
  const rect = target?.getBoundingClientRect()
  const layer = document.createElement('div')
  const box = rect && rect.width > 0 && rect.height > 0 ? rect : null
  layer.style.cssText = [
    'position:fixed',
    'left:' + (box ? box.left : 0) + 'px',
    'top:' + (box ? box.top : 0) + 'px',
    'width:' + (box ? box.width : '100vw') + (box ? 'px' : ''),
    'height:' + (box ? box.height : '100vh') + (box ? 'px' : ''),
    'z-index:100000',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:linear-gradient(180deg, rgba(15,23,42,0.06), rgba(15,23,42,0.18))',
    'backdrop-filter:blur(2px)',
    'cursor:progress',
  ].join(';')
  const card = document.createElement('div')
  card.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:8px 14px',
    'border-radius:16px',
    'background:#ffffff',
    'border:1px solid rgba(0,0,0,0.08)',
    'box-shadow:0 20px 40px rgba(0,0,0,0.08)',
    'font:600 13px/1.4 system-ui, sans-serif',
    'color:#374151',
  ].join(';')
  const dot = document.createElement('span')
  dot.className = 'canvas-export-ring'
  dot.style.cssText = [
    'width:10px',
    'height:10px',
    'border-radius:999px',
    'background:#0891b2',
    'animation:' + OVERLAY_ANIM + ' 1.2s ease-out infinite',
  ].join(';')
  const label = document.createElement('span')
  label.textContent = '正在导出…'
  card.appendChild(dot)
  card.appendChild(label)
  layer.appendChild(card)
  document.body.appendChild(layer)
  return {
    el: layer,
    progress: (done, total) => {
      label.textContent = total > 1 ? '正在导出 ' + done + '/' + total + '…' : '正在导出…'
    },
  }
}

/**
 * 在输出画布上按 flow 坐标画背景（底色 + 圆点网格）。
 * 坐标换算：flow 点 p → 设备像素 (p - rect.origin) × scale。网格取 <rect> 范围内、24 的整数倍的那些 flow 坐标，
 * 与画布原点同锚，所以和画布上看到的网格对齐。背景是**整张画布一次性画完**的，不参与分块，拼出来天然连续。
 */
function paintBackground(
  out: CanvasRenderingContext2D,
  rect: Rect,
  scale: number,
  bgColor: string,
  dotColor: string,
): void {
  const w = out.canvas.width
  const h = out.canvas.height
  out.fillStyle = bgColor
  out.fillRect(0, 0, w, h)
  if (!dotColor) return
  const r = Math.max(0.5, BG_DOT_R * scale)
  out.fillStyle = dotColor
  out.beginPath()
  // 范围极大时按 24 的整数倍放宽间距，避免几十万个点把页面画卡（与「节点多不能卡」同一诉求）
  const stepFlow = backgroundGridStep(rect, BG_GRID, MAX_BG_DOTS)
  if (!(stepFlow > 0)) return
  const startX = Math.floor(rect.x / stepFlow) * stepFlow
  const startY = Math.floor(rect.y / stepFlow) * stepFlow
  for (let fx = startX; fx <= rect.x + rect.w; fx += stepFlow) {
    const dx = (fx - rect.x) * scale
    if (dx < -r * 2 || dx > w + r * 2) continue
    for (let fy = startY; fy <= rect.y + rect.h; fy += stepFlow) {
      const dy = (fy - rect.y) * scale
      if (dy < -r * 2 || dy > h + r * 2) continue
      out.moveTo(dx + r, dy) // 起点取圆的 0 度位置，否则会多画一条连到圆上的短线
      out.arc(dx, dy, r, 0, Math.PI * 2)
    }
  }
  out.fill()
}

/**
 * 拍一块：把当前视口（已对齐到块原点、zoom=1）渲染成 pane 尺寸的位图。
 * 返回 canvas 的尺寸 = pane × scale；本块实际要用的只是它左上角 tile.w × tile.h 那一片。
 *
 * fontEmbedCSS：字体 CSS 由调用方**只算一次**传进来复用。html-to-image 不传就会每块都重新抓一遍
 * 页面上所有字体并转 dataURL——块一多就是个可观的浪费（与「节点多不能卡」同一个诉求）。
 */
async function renderPane(
  el: HTMLElement,
  paneW: number,
  paneH: number,
  scale: number,
  filter: (node: HTMLElement) => boolean,
  fontEmbedCSS?: string,
): Promise<HTMLCanvasElement> {
  return toCanvas(el, {
    width: paneW,
    height: paneH,
    pixelRatio: scale,
    filter,
    fontEmbedCSS,
  })
}

export function apply(ctx: Context) {
  const { selection } = ctx

  const settings = () => ctx.get<SettingsPort | undefined>('settings')
  const numOf = (key: string, fallback: number): number => {
    const v = settings()?.get(key)
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback
  }
  const boolOf = (key: string, fallback: boolean): boolean => {
    const v = settings()?.get(key)
    return typeof v === 'boolean' ? v : fallback
  }
  const strOf = (key: string, fallback: string): string => {
    const v = settings()?.get(key)
    return typeof v === 'string' && v.trim() !== '' ? v : fallback
  }

  /** 收集可导出的节点矩形：丢掉中间态节点（拖线落空白的临时菜单卡不是用户作品，不该进导出图） */
  function collectNodeRects(): NodeRect[] {
    const layout = ctx.get<NodeLayoutPort | undefined>('nodeLayout')
    const store = ctx.get<NodeStorePort | undefined>('nodeStore')
    const rects = layout?.getAllRects?.() ?? []
    if (!store) return rects
    const byId = new Map(store.getNodes().map((n) => [n.id, n]))
    return rects.filter((r) => !isTransient(byId.get(r.id)))
  }

  /** 收集可导出的连线：同样丢掉中间态边（占位连线） */
  function collectEdges(): Array<{ id: string; source: string; target: string }> {
    const store = ctx.get<EdgeStorePort | undefined>('edgeStore')
    const edges = store?.getEdges?.() ?? []
    return edges.filter((e) => !isTransient(e)).map((e) => ({ id: e.id, source: e.source, target: e.target }))
  }

  /**
   * 导出主流程。
   * @param type full = 全画布内容；selected = 仅选中节点
   */
  async function exportCanvas(type: ExportType): Promise<void> {
    if (type === 'selected' && selection.ids.size === 0) {
      console.warn('[canvas-export] 没有选中节点')
      return
    }
    const vp = ctx.get<ViewportPort | undefined>('viewport')
    const el = getFlowEl(ctx)
    if (!el || !vp) {
      console.warn('[canvas-export] 未找到画布元素 (.vue-flow__viewport)')
      return
    }

    // pane 尺寸 = 每块的取景尺寸（取整，保证拼缝像素对齐）
    const rect0 = el.getBoundingClientRect()
    const paneW = Math.round(el.clientWidth || rect0.width)
    const paneH = Math.round(el.clientHeight || rect0.height)
    if (!(paneW > 0) || !(paneH > 0)) {
      // 画布被隐藏/尺寸为 0（如 display:none）时没有可截的画面，直接报错而不是导出一张 1px 的废图
      console.warn('[canvas-export] 画布当前不可见或尺寸为 0，无法导出')
      return
    }

    const nodeRects = collectNodeRects()
    const edges = collectEdges()
    const padding = Math.max(0, numOf('exportSelectedRectPadding', 4))

    // 全量模式在图里一个节点都没有时，退到「当前可视区」，避免导出一张空图
    const saved = vp.getViewport()
    const fallbackRect = visibleRectInFlow(saved, paneW, paneH)
    const plan = planExport({
      mode: type,
      nodes: nodeRects,
      edges,
      selectedNodeIds: selection.ids,
      padding,
      fallbackRect,
    })
    if (!plan) {
      console.warn(
        type === 'selected' ? '[canvas-export] 选中节点不在画布上，无法导出' : '[canvas-export] 画布上没有内容',
      )
      return
    }

    // 范围取整到整数像素：块坐标与贴图偏移全是整数，拼缝才不会有半像素模糊线
    const rect = roundRectOutward(plan.rect)
    if (!(rect.w > 0) || !(rect.h > 0)) {
      console.warn('[canvas-export] 导出范围为空')
      return
    }
    const tiles = planTiles(rect, paneW, paneH)
    if (tiles.length === 0) {
      console.warn('[canvas-export] 导出范围为空')
      return
    }
    if (tiles.length > MAX_EXPORT_TILES) {
      console.warn(
        '[canvas-export] 需要切 ' + tiles.length + ' 块，超出上限（' + MAX_EXPORT_TILES + ' 块），无法一次导出。',
      )
      return
    }
    if (tiles.length > LARGE_EXPORT_TILES) {
      // 只是一句提醒：导出照常进行，进度在遮罩上可见（大图本来就需要时间，不偷偷拒绝用户）
      console.warn('[canvas-export] 本次导出范围较大，需要 ' + tiles.length + ' 块，请稍候…')
    }

    // 清晰度倍数：先按期望值，装不下就降；再受「单块截图尺寸也不能超上限」约束
    const desired = numOf('exportScale', EXPORT_SCALE_DEFAULT)
    const fitted = fitScale(rect, desired)
    const scale = fitted === null ? null : clampScaleForPane(fitted, paneW, paneH)
    if (scale === null || scale < EXPORT_SCALE_MIN) {
      console.warn(
        '[canvas-export] 内容过大（' + rect.w + '×' + rect.h + '），最小的 1 倍也超出单张图上限，无法导出。',
      )
      return
    }

    const size = outputSize(rect, scale)
    if (exceedsMaxDimension(size)) {
      console.warn('[canvas-export] 导出图尺寸 ' + size.w + '×' + size.h + ' 超过上限，无法导出。')
      return
    }

    const out = document.createElement('canvas')
    out.width = size.w
    out.height = size.h
    const octx = out.getContext('2d')
    if (!octx) {
      console.warn('[canvas-export] 无法创建导出画布')
      return
    }

    if (boolOf('exportBackground', true)) {
      paintBackground(
        octx,
        rect,
        scale,
        strOf('exportBackgroundColor', '#f8fafc'),
        strOf('exportDotColor', '#cbd5e1'),
      )
    }

    const rectById = new Map(nodeRects.map((r) => [r.id, r]))
    let failedTiles = 0

    // 罩住画布：分块取景会把视口临时切到 zoom=1，块多时肉眼可见，必须挡住不让用户看到跳动
    const overlay = showExportOverlay(el)
    await nextFrame() // 等遮罩先画上，再开始折腾视口

    // 字体 CSS 只抓一次（首次会触发字体请求；抓不到就退回让截图库每块自己抓，不影响导出）
    let fontEmbedCSS = ''
    try {
      fontEmbedCSS = await getFontEmbedCSS(el)
    } catch (err) {
      console.warn('[canvas-export] 内联字体失败，改用系统字体渲染：', err)
    }

    try {
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i]
        overlay.progress(i + 1, tiles.length)
        // 1) 把「本块左上角」移到容器原点：屏幕点 = 平移 + flow × zoom ⇒ 平移 = -块原点
        vp.setViewport({ x: -tile.x, y: -tile.y, zoom: 1 })
        // 2) 等新 transform 落进 DOM（Vue 渲染 + 浏览器绘制）
        await nextFrame()

        // 3) 只保留本块需要的节点/连线（克隆阶段过滤，真实 DOM 不动、不闪）
        const keepNodes = tileNodeIds(nodeRects, plan.nodeIds, tile)
        const keepEdges = tileEdgeIds(edges, rectById, plan.edgeIds, tile)

        let pane: HTMLCanvasElement
        try {
          pane = await renderPane(
            el,
            paneW,
            paneH,
            scale,
            makeExportFilter(keepNodes, keepEdges),
            fontEmbedCSS || undefined,
          )
        } catch (err) {
          failedTiles++
          console.warn('[canvas-export] 某一块截图失败，已跳过：', err)
          continue
        }

        // 4) 取本块那一片，贴到输出画布对应位置（坐标全整数 → 拼缝严丝合缝）
        const dw = Math.max(1, Math.round(tile.w * scale))
        const dh = Math.max(1, Math.round(tile.h * scale))
        octx.drawImage(pane, 0, 0, dw, dh, (tile.x - rect.x) * scale, (tile.y - rect.y) * scale, dw, dh)
      }

      if (failedTiles > 0) {
        console.warn('[canvas-export] 有 ' + failedTiles + '/' + tiles.length + ' 块没截成功，导出图可能不完整。')
      }

      const dataUrl = out.toDataURL('image/png')
      const prefix = type === 'selected' ? 'canvas-selected-' : 'canvas-export-'
      downloadPng(dataUrl, prefix + Date.now() + '.png')
      ctx.emit(
        'canvas-export:exported',
        type === 'selected' ? { type: 'selected', count: selection.ids.size } : { type: 'full' },
      )
    } catch (err) {
      // 常见原因：画布里有跨域图片把 canvas 污染了，导致导出（toDataURL）被浏览器拒绝
      console.error('[canvas-export] 导出失败:', err)
    } finally {
      // 无论如何都要还原：视口回原位、遮罩摘掉（出错也不能把用户画布卡在临时状态）
      vp.setViewport(saved)
      overlay.el.remove()
    }
  }

  ctx.commands.register({
    id: 'canvas-export:full',
    title: '导出画布',
    keys: ['mod+e'],
    group: 'export',
    order: 10,
    run: () => exportCanvas('full'),
  })
  ctx.commands.register({
    id: 'canvas-export:selected',
    title: '导出选中节点',
    keys: ['mod+shift+e'],
    group: 'export',
    order: 20,
    run: () => exportCanvas('selected'),
  })
}

/** 兼容旧装配的 PluginModule 出口 */
export const canvasExportPlugin: PluginModule = { name, inject, Config, apply }
