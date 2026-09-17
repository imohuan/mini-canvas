/**
 * editingViewport —— 进入编辑态时把节点"拉进视野"的几何（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 为什么需要它（用户实测报的「你的图片扩展也全是 BUG，UI 控制端口移动错误显示」）：
 * 用真实鼠标事件实测到的根因 —— 节点停在画布偏下的位置，扩展框往四周长大之后卡片底部
 * 跑到视口之外（实测卡片底 899px、视口只有 720px），下侧三个控制点在 elementFromPoint 里
 * 返回 null，**根本点不到**。控制点没画错，是被推出屏幕了。
 * v1 的老做法是进编辑态时 fitView({ nodes:[id], padding, maxZoom })，这里把那段几何算清楚。
 *
 * 坐标约定（**同一套坐标系**，这是这个模块最容易错的地方）：
 * 节点与"可视区"都给 **flow 坐标**：
 *   node    = { x, y, width, height }     节点在画布上的位置与尺寸
 *   visible = { x, y, width, height }     当前可视区在画布上的矩形（左上角 + 大小）
 * 于是"看不看得见"就是两个 flow 矩形的包含判断，不必掺缩放。
 * zoom 只用来算"该缩到多少"，不参与位置判断。
 *
 * 为什么要留编辑余量：编辑框会往外长。若把节点刚好铺满视口，往外一拉立刻出界，
 * 又回到"控制点被推出屏幕"那个坑里。
 */

/** 矩形（flow 坐标） */
export interface NodeRect {
  x: number
  y: number
  width: number
  height: number
}

/** 计算输入（node 与 visible 都在 flow 坐标系内） */
export interface EditingViewportInput {
  /** 节点当前矩形（flow 坐标） */
  node: NodeRect
  /** 当前可视区矩形（flow 坐标；左上角 = -viewport.x/zoom, -viewport.y/zoom） */
  visible: NodeRect
  /** 当前视口缩放（只用于判断"尺寸是否超出视口"与算目标缩放） */
  zoom: number
  /** 编辑余量：四周额外留出的空间比例（0.6 = 各边留节点尺寸的 60%） */
  margin?: number
  /** 允许的缩放范围 */
  minZoom?: number
  maxZoom?: number
}

/** 计算输出：该把视口中心放到哪个画布坐标、用多大缩放 */
export interface EditingViewport {
  /** setCenter 用的画布坐标（节点中心） */
  centerX: number
  centerY: number
  /** 建议缩放 */
  zoom: number
}

/** 正数守卫 */
function positive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}

/** 默认编辑余量（各边留节点尺寸的 60%，给外扩留空间） */
export const DEFAULT_EDITING_MARGIN = 0.6
/** 编辑态允许的最小/最大缩放（对齐 v1 fitView 的 maxZoom: 4 与画布默认下限） */
export const DEFAULT_EDITING_MIN_ZOOM = 0.1
export const DEFAULT_EDITING_MAX_ZOOM = 4

/** 解析出各输入的有效值（非法项各自回落默认） */
function normalize(input: EditingViewportInput): {
  node: NodeRect
  visible: NodeRect
  zoom: number
  margin: number
  minZoom: number
  maxZoom: number
} | null {
  const nw = positive(input.node.width, 0)
  const nh = positive(input.node.height, 0)
  const vw = positive(input.visible.width, 0)
  const vh = positive(input.visible.height, 0)
  if (nw <= 0 || nh <= 0 || vw <= 0 || vh <= 0) return null
  const margin =
    typeof input.margin === 'number' && Number.isFinite(input.margin) && input.margin >= 0
      ? input.margin
      : DEFAULT_EDITING_MARGIN
  return {
    node: { x: input.node.x, y: input.node.y, width: nw, height: nh },
    visible: { x: input.visible.x, y: input.visible.y, width: vw, height: vh },
    zoom: positive(input.zoom, 1),
    margin,
    minZoom: positive(input.minZoom, DEFAULT_EDITING_MIN_ZOOM),
    maxZoom: positive(input.maxZoom, DEFAULT_EDITING_MAX_ZOOM),
  }
}

/**
 * 算出"进入编辑态该把视口放哪"：
 * - 中心放在节点中心（居中，控制点离四边等距）；
 * - 缩放取"能让节点 + 余量装进可视区"的比例，再夹进 [minZoom, maxZoom]。
 *
 * @returns 视口参数；尺寸非法时返回 null（调用方保持原视口不动，不瞎跳）
 */
export function resolveEditingViewport(input: EditingViewportInput): EditingViewport | null {
  const n = normalize(input)
  if (!n) return null
  // 需要装下的 flow 范围 = 节点 + 两侧余量
  const needW = n.node.width * (1 + n.margin * 2)
  const needH = n.node.height * (1 + n.margin * 2)
  // visible 是 flow 大小，而目标缩放是"flow → 屏幕"的比例，
  // 所以能装下的比例就是 屏幕可视尺寸 / 需要的 flow 尺寸。这里用 visible*当前缩放 还原屏幕尺寸。
  const screenW = n.visible.width * n.zoom
  const screenH = n.visible.height * n.zoom
  const raw = Math.min(screenW / needW, screenH / needH)
  const zoom = Math.min(Math.max(raw, n.minZoom), n.maxZoom)
  return {
    centerX: n.node.x + n.node.width / 2,
    centerY: n.node.y + n.node.height / 2,
    zoom,
  }
}

/**
 * 该不该动视口：只在"节点（含余量）看不见/看不全"时才动。
 *
 * 为什么不一进编辑就无条件居中：用户可能正看着别处、或刚手动调好视角，
 * 每次进出编辑都把画面拽走会很烦。只在真的需要时才拉一把。
 *
 * 两个判据缺一不可（实测踩过第二个）：
 * 1. **尺寸装不下**：节点（含余量）比可视区还大；
 * 2. **位置在视野外**：尺寸够小、但节点被摆到了可视区之外 —— 按尺寸判会得出"装得下"，
 *    可用户根本看不见它（这个正是实测现场的形态）。
 */
export function shouldFitEditingViewport(input: EditingViewportInput): boolean {
  const n = normalize(input)
  if (!n) return false
  const padX = n.node.width * n.margin
  const padY = n.node.height * n.margin

  // ① 尺寸装不下（含余量的节点比可视区还大）
  if (n.node.width + padX * 2 > n.visible.width + 0.5) return true
  if (n.node.height + padY * 2 > n.visible.height + 0.5) return true

  // ② 位置不在可视区内（含余量后越界即算看不见）
  const left = n.node.x - padX
  const top = n.node.y - padY
  const right = n.node.x + n.node.width + padX
  const bottom = n.node.y + n.node.height + padY
  const vLeft = n.visible.x
  const vTop = n.visible.y
  const vRight = n.visible.x + n.visible.width
  const vBottom = n.visible.y + n.visible.height
  if (left < vLeft - 0.5 || top < vTop - 0.5 || right > vRight + 0.5 || bottom > vBottom + 0.5) return true

  return false
}

