/**
 * exportGeometry —— 画布导出几何纯逻辑（零 DOM、零 Vue、零内核依赖，Node 可单测）。
 *
 * 背景（导出"高质量 1:1 图"的根本约束）：
 * 截图锚点 .vue-flow__viewport 只有"窗口那么大"，而且 overflow:clip——它只能拍到当前视口内的内容。
 * 所以想导出"整张图 / 一大片区域"，必须分块取景再拼回一张：
 *   1. 先算导出范围 rect（flow 绝对坐标）；
 *   2. 按 pane 尺寸把 rect 切成若干块（tile）；
 *   3. 每块把视口平移让该块对齐到容器原点，按 zoom=1 拍一张，贴到大画布对应位置；
 *   4. 全部贴完 = 一整张 1:1 图，与用户当前缩放无关。
 *
 * 为什么分块反而更快（节点多也不卡）：
 * 每块取景时用 html-to-image 的 filter 跳过"不在本块里的节点/连线"——克隆成本只与"块内元素数"成正比，
 * 不再与"全图元素数"成正比。所以 500 个节点不会变成 500 份克隆，每块只克隆自己那几颗。
 *
 * 跨块元素（用户点名的"交叉情况"）怎么不出错：
 * 相邻块拍的是**同一份 DOM 的同一片内容**，只是平移不同。所以跨越块边界的节点/连线在左块画一半、
 * 右块画另一半，贴回去天然严丝合缝——不需要"每块都完整画一遍跨块元素"。
 * 唯一的硬要求：块坐标必须是整数像素（见 roundRectOutward + planTiles 的整数入参约定），
 * 否则拼缝处会出现半像素模糊线。
 *
 * 余量（NODE_TILE_MARGIN / EDGE_TILE_MARGIN）解决"切到阴影/光晕/曲线外扩"：
 * 节点的阴影、连线的 bezier 控制点都会画到"本体矩形之外"。若严格按矩形相交取元素，
 * 跨越边界的阴影会被切出一条硬边。故判定"这块要不要这个元素"时把元素的框外扩一点。
 */

/** flow 绝对坐标下的矩形（与 NodeLayoutService LayoutRect 同形，去掉 id） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 带 id 的节点矩形（= nodeLayout.getAllRects() 的元素形状） */
export interface NodeRect extends Rect {
  id: string
}

/** 连线的最小几何信息（端点 id 足够定位它的走向范围） */
export interface EdgeRef {
  id: string
  source: string
  target: string
}

export interface Size {
  w: number
  h: number
}

/** 视口状态快照（与 ViewportService.getViewport() 同形） */
export interface ViewportLike {
  x: number
  y: number
  zoom: number
}

/** 导出清晰度倍数默认/范围（倍数就是 pixelRatio：1 = 与 CSS 像素 1:1，2 = 两倍密度） */
export const EXPORT_SCALE_DEFAULT = 2
export const EXPORT_SCALE_MIN = 1
export const EXPORT_SCALE_MAX = 4

/** 单张 canvas 的浏览器硬上限（html-to-image 内部也以此值自动缩水；我们宁可拒绝也不出糊图） */
export const MAX_EXPORT_DIMENSION = 16384

/** 一次导出最多切多少块（块太多说明范围过大；宁可提示用户缩小范围，也不要让人干等几分钟） */
export const MAX_EXPORT_TILES = 256
/** 超过这个块数就提醒用户「这次导出比较大，要等一会儿」（仍然照常导出，不拒绝） */
export const LARGE_EXPORT_TILES = 64

/** 背景点阵最多画多少个点（范围极大时自动放宽网格间距，避免几十万个点把页面卡住） */
export const MAX_BG_DOTS = 20000

/** 节点取块余量：节点阴影/光晕画在本体矩形之外，块边缘放开这些像素，拼缝才不会被切出硬线 */
export const NODE_TILE_MARGIN = 24

/** 连线取块余量：bezier 控制点沿端口方向外扩 minCurvature(80)，再加光晕/箭头余量 */
export const EDGE_TILE_MARGIN = 120

/** 两个矩形并集（null 视作空；两个都空返回 null） */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  // 只取四要素：入参可能是带 id 的 NodeRect，包围盒不该把 id 漏给调用方
  if (!a) return b ? plainRect(b) : null
  if (!b) return plainRect(a)
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const right = Math.max(a.x + a.w, b.x + b.w)
  const bottom = Math.max(a.y + a.h, b.y + b.h)
  return { x, y, w: right - x, h: bottom - y }
}

/** 抽出纯矩形四要素（丢掉 id 等附加字段） */
function plainRect(r: Rect): Rect {
  return { x: r.x, y: r.y, w: r.w, h: r.h }
}

/** 一组节点矩形的外接包围盒（空数组 → null） */
export function contentBounds(rects: readonly Rect[]): Rect | null {
  let out: Rect | null = null
  for (const r of rects) out = unionRect(out, r)
  return out
}

/** 四边同量外扩（pad 非正/非有限 → 原样返回，不收缩） */
export function expandRect(rect: Rect, pad: number): Rect {
  const p = Number.isFinite(pad) && pad > 0 ? pad : 0
  if (p === 0) return { ...rect }
  return { x: rect.x - p, y: rect.y - p, w: rect.w + p * 2, h: rect.h + p * 2 }
}

/** 两矩形是否重叠（margin > 0 时把 b 外扩一圈再判；仅贴边不算重叠） */
export function intersects(a: Rect, b: Rect, margin = 0): boolean {
  const m = Number.isFinite(margin) && margin > 0 ? margin : 0
  return (
    a.x < b.x + b.w + m &&
    b.x < a.x + a.w + m &&
    a.y < b.y + b.h + m &&
    b.y < a.y + a.h + m
  )
}

/**
 * 把矩形向外取整到整数像素边界（左上取 floor、右下取 ceil）。
 * 分块拼图必须像素对齐：范围取整后，块坐标/贴图偏移全是整数，拼缝才不会有半像素模糊。
 */
export function roundRectOutward(rect: Rect): Rect {
  const x = Math.floor(rect.x)
  const y = Math.floor(rect.y)
  const right = Math.ceil(rect.x + rect.w)
  const bottom = Math.ceil(rect.y + rect.h)
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}

/** 归一清晰度倍数：非有限值回落默认；四舍五入后夹到 [1,4] */
export function normalizeScale(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n)) return EXPORT_SCALE_DEFAULT
  const rounded = Math.round(n)
  if (rounded < EXPORT_SCALE_MIN) return EXPORT_SCALE_MIN
  if (rounded > EXPORT_SCALE_MAX) return EXPORT_SCALE_MAX
  return rounded
}

/** 输出像素尺寸（尺寸 × 倍数；最小 1px，绝不返回 0/负） */
export function outputSize(rect: Rect, scale: number): Size {
  const s = normalizeScale(scale)
  return {
    w: Math.max(1, Math.round(rect.w * s)),
    h: Math.max(1, Math.round(rect.h * s)),
  }
}

/** 是否超过单张 canvas 上限（超过就得降倍数或拒绝导出，硬拍会被浏览器自动缩水成糊图） */
export function exceedsMaxDimension(size: Size): boolean {
  return size.w > MAX_EXPORT_DIMENSION || size.h > MAX_EXPORT_DIMENSION
}

/**
 * 在"不超过 canvas 上限"的前提下，尽量取接近期望的整数倍数。
 * 返回 null = 连 1 倍都超限（内容大到没法一张图装下，调用方应报错而不是硬拍）。
 */
export function fitScale(rect: Rect, desired: number): number | null {
  const want = normalizeScale(desired)
  for (let s = want; s >= EXPORT_SCALE_MIN; s--) {
    if (!exceedsMaxDimension(outputSize(rect, s))) return s
  }
  return null
}

/**
 * 每块截图本身也要受画布上限约束：单块渲染尺寸 = pane 尺寸 × 倍数。
 * 极端情况下（超大窗口 × 高倍数）单块就会超限，此时把倍数降到单块能装下的最大值。
 * 返回结果可能 < EXPORT_SCALE_MIN（连 1 倍都装不下），由调用方拒绝导出。
 */
export function clampScaleForPane(scale: number, paneW: number, paneH: number): number {
  const want = normalizeScale(scale)
  const limit = Math.max(1, paneW, paneH)
  const maxByPane = Math.floor(MAX_EXPORT_DIMENSION / limit)
  if (maxByPane < EXPORT_SCALE_MIN) return maxByPane
  return Math.min(want, maxByPane)
}

/**
 * 背景圆点网格的**flow 坐标**间距。
 * 正常就是 grid（画布上看到的是 24）；范围特别大时按 grid 的整数倍放宽，使总点数不超过 maxDots，
 * 否则一张超大的导出图会要画几十万个圆点，直接卡死（与「节点多不能卡」同一个诉求）。
 */
export function backgroundGridStep(rect: Rect, grid: number, maxDots: number): number {
  if (!(grid > 0) || !Number.isFinite(grid)) return 0
  const limit = Number.isFinite(maxDots) && maxDots > 0 ? maxDots : Number.POSITIVE_INFINITY
  // 按最终间距精确算点数（floor(w/step)+1 就是这条轴上实际会画的点数），避免估算偏乐观
  const dotsAt = (step: number): number =>
    (Math.floor(rect.w / step) + 1) * (Math.floor(rect.h / step) + 1)
  if (dotsAt(grid) <= limit) return grid
  // 需要放大的整数倍：找到最小的 k 使点数落回上限内
  let k = 2
  while (k < 100000 && dotsAt(grid * k) > limit) k++
  return grid * k
}

/**
 * 当前可视区对应的 flow 矩形（zoom=1 导出时用来兜底"图里一个节点都没有"的场景）。
 * 换算：屏幕点 = 平移 + flow × zoom ⇒ flow = (屏幕 - 平移) / zoom。
 * zoom 非法（0/负/NaN）按 1 处理；pane 尺寸为 0 → null。
 */
export function visibleRectInFlow(viewport: ViewportLike, paneW: number, paneH: number): Rect | null {
  if (!(paneW > 0) || !(paneH > 0)) return null
  const z = Number.isFinite(viewport.zoom) && viewport.zoom > 0 ? viewport.zoom : 1
  const ox = Number.isFinite(viewport.x) ? viewport.x : 0
  const oy = Number.isFinite(viewport.y) ? viewport.y : 0
  // -0 / 1 会得到 -0（值上等于 0，但比较/序列化时很别扭），统一归一成 0
  return { x: ox === 0 ? 0 : -ox / z, y: oy === 0 ? 0 : -oy / z, w: paneW / z, h: paneH / z }
}

/**
 * 把导出范围切成不重叠的块（行优先）。
 * 入参约定：rect 已 roundRectOutward、tileW/tileH 为整数 → 输出的 x/y/w/h 全是整数，保证像素对齐。
 * 范围比块小 → 单块（返回 rect 本身）；范围为空 → 空数组。
 */
export function planTiles(rect: Rect, tileW: number, tileH: number): Rect[] {
  if (!(rect.w > 0) || !(rect.h > 0)) return []
  const tw = tileW > 0 ? tileW : rect.w
  const th = tileH > 0 ? tileH : rect.h
  const eps = 1e-9 // 防浮点误差把"正好整除"算成多一行/一列
  const cols = Math.max(1, Math.ceil(rect.w / tw - eps))
  const rows = Math.max(1, Math.ceil(rect.h / th - eps))
  const tiles: Rect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = rect.x + c * tw
      const y = rect.y + r * th
      const w = Math.min(tw, rect.x + rect.w - x)
      const h = Math.min(th, rect.y + rect.h - y)
      if (w > 0 && h > 0) tiles.push({ x, y, w, h })
    }
  }
  return tiles
}

/**
 * 本块需要保留的节点 id（取块时喂给 html-to-image 的 filter）。
 * margin 见 NODE_TILE_MARGIN：阴影/光晕画在框外，边界外一小圈也要算进来，拼缝才不被切。
 */
export function tileNodeIds(
  nodes: readonly NodeRect[],
  allowed: ReadonlySet<string>,
  tile: Rect,
  margin = NODE_TILE_MARGIN,
): Set<string> {
  const keep = new Set<string>()
  for (const n of nodes) {
    if (!allowed.has(n.id)) continue
    if (intersects(n, tile, margin)) keep.add(n.id)
  }
  return keep
}

/**
 * 本块需要保留的连线 id。
 * 每条边用一个"两端节点外接盒 + margin"近似它的走向范围：这样一条横穿好几块的长线，
 * 在它路过的每一块里都会被保留（否则中间块会缺线），而完全不相干的块不会白画它。
 * 判定前提：边的两端都在本次导出的节点集内（on-the-fly 丢弃悬空线，见 planExport）。
 */
export function tileEdgeIds(
  edges: readonly EdgeRef[],
  rectById: ReadonlyMap<string, NodeRect>,
  allowed: ReadonlySet<string>,
  tile: Rect,
  margin = EDGE_TILE_MARGIN,
): Set<string> {
  const keep = new Set<string>()
  for (const e of edges) {
    if (!allowed.has(e.id)) continue
    const s = rectById.get(e.source)
    const t = rectById.get(e.target)
    if (!s || !t) continue
    const box = unionRect(s, t)
    if (box && intersects(box, tile, margin)) keep.add(e.id)
  }
  return keep
}

/** 一次导出的完整计划：范围 + 允许出现在图里的节点/连线（越界元素在这里就被剔掉） */
export interface ExportPlan {
  /** 导出范围（flow 绝对坐标，未取整） */
  rect: Rect
  /** 允许出现的节点 id */
  nodeIds: Set<string>
  /** 允许出现的连线 id（两端都在 nodeIds 内才留） */
  edgeIds: Set<string>
}

/** planExport 入参 */
export interface PlanExportRequest {
  /** full = 全画布内容；selected = 仅选中节点 */
  mode: 'full' | 'selected'
  /** 全部存活节点矩形（nodeLayout.getAllRects()） */
  nodes: readonly NodeRect[]
  /** 全部连线（edgeStore.getEdges()） */
  edges: readonly EdgeRef[]
  /** 当前选中节点 id */
  selectedNodeIds: ReadonlySet<string>
  /** 包围盒向外扩展像素 */
  padding: number
  /** full 模式下"图里一个节点都没有"时的兜底范围（当前可视区；没有则返回 null） */
  fallbackRect?: Rect | null
}

/**
 * 算导出计划。
 * - full：范围 = 所有节点包围盒 + padding；节点全留。无节点时退到 fallbackRect（可视区）。
 * - selected：范围 = 选中节点包围盒 + padding；只留选中节点，以及"两端都被选中"的连线
 *   （只选中一端的线会拖到图外，留着就是一条悬空线，故丢弃）。
 * 返回 null = 没有可导出的内容（调用方据此提示，不产生空文件）。
 */
export function planExport(req: PlanExportRequest): ExportPlan | null {
  const { mode, nodes, edges, selectedNodeIds, padding } = req

  if (mode === 'full') {
    const bounds = contentBounds(nodes)
    if (bounds) {
      const nodeIds = new Set(nodes.map((n) => n.id))
      return { rect: expandRect(bounds, padding), nodeIds, edgeIds: connectedEdgeIds(edges, nodeIds) }
    }
    const fallback = req.fallbackRect
    if (!fallback) return null
    return { rect: { ...fallback }, nodeIds: new Set(), edgeIds: new Set() }
  }

  const picked = nodes.filter((n) => selectedNodeIds.has(n.id))
  const bounds = contentBounds(picked)
  if (!bounds) return null
  const nodeIds = new Set(picked.map((n) => n.id))
  return { rect: expandRect(bounds, padding), nodeIds, edgeIds: connectedEdgeIds(edges, nodeIds) }
}

/** 两端都在给定节点集内的连线 id（丢掉悬空线：防止导出图里出现拖到图外的线） */
function connectedEdgeIds(edges: readonly EdgeRef[], nodeIds: ReadonlySet<string>): Set<string> {
  const keep = new Set<string>()
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) keep.add(e.id)
  }
  return keep
}

// ==================== 导出取景时的元素取舍（喂给 html-to-image 的 filter）====================

/**
 * 判定画布里的某个 DOM 元素要不要进导出图。
 *
 * 抽成纯函数的原因：这里有个**极易踩空的 DOM 细节**——
 * VueFlow 里每个节点是 <div class="vue-flow__node" data-id>，但每条连线是
 * <svg class="vue-flow__edges"><g class="vue-flow__edge" data-id>…</g></svg>：
 * id 挂在内层 <g> 上，而 html-to-image 对 <svg> 是整体深拷贝（不再递归过滤子节点），
 * 所以**过滤连线必须在 <svg> 外壳这一层**做，靠外壳去查内部那个 <g> 的 data-id。
 * 这段规则藏在纯函数里，就能脱离浏览器单测。
 */
export interface ExportElementInfo {
  /** 元素的 class 列表 */
  classes: readonly string[]
  /** 元素自身的 data-id（节点、或连线内层 <g>） */
  dataId: string | null
  /** 连线 <svg> 外壳内部那条 <g> 的 data-id（非外壳传 null） */
  innerEdgeId: string | null
  /** 要剔除的调试叠加类名（端口辅助线/吸附区等） */
  debugClasses: readonly string[]
  /** 本次允许进图的节点 id */
  keepNodes: ReadonlySet<string>
  /** 本次允许进图的连线 id */
  keepEdges: ReadonlySet<string>
}

/** 该元素是否保留在导出图里（false = 跳过它及其子树） */
export function keepExportElement(info: ExportElementInfo): boolean {
  const classes = new Set(info.classes)
  for (const debugClass of info.debugClasses) {
    if (classes.has(debugClass)) return false
  }
  if (classes.has('vue-flow__node')) {
    return !!info.dataId && info.keepNodes.has(info.dataId)
  }
  if (classes.has('vue-flow__edge')) {
    return !!info.dataId && info.keepEdges.has(info.dataId)
  }
  // 连线外壳 <svg>：id 在内层 <g>，必须靠 innerEdgeId 判
  if (classes.has('vue-flow__edges')) {
    return !!info.innerEdgeId && info.keepEdges.has(info.innerEdgeId)
  }
  return true
}
