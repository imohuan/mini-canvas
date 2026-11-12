/**
 * themePreview —— 主题工作台「预览画板」的绘制契约。
 *
 * 这里不再用 Vue 组件叠加，而是**一组同步的绘制函数**：
 * 宿主按 order 依次调用每层的 paint(ctx)，每层拿到自己的 div（绝对定位、铺满画板），
 * 自己决定往里面放什么 DOM，也可以读 host 提供的真实节点矩形。
 *
 * 为什么改成函数：
 * - 预览是"一次性把画面画出来"，没有交互、没有响应式状态，用 Vue 组件反而要处理挂载顺序；
 * - 节点高度由浏览器排版决定（文字多就会被撑高），绘制函数每次执行都现读矩形，
 *   端口 / 连线 / 选框 / 刀光因此天然对齐；
 * - 插件作者只写一个 paint 函数，卸载时宿主整层删掉，没有组件生命周期要管。
 */

/** 预览画布统一使用的槽名（插件往这里注册自己的绘制层）。 */
export const THEME_PREVIEW_SLOT = 'theme-preview'

/** 画板坐标（px，原点在画板左上角）。 */
export interface PreviewRect {
  x: number
  y: number
  w: number
  h: number
}

/** 预览里的一个节点：矩形 + 身份，供图层区分"这是第几个节点"。 */
export interface PreviewNodeRect extends PreviewRect {
  id: string
  /** 节点类型（text / image / …），图层可以据此画不同的壳 */
  kind?: string
  /** 标题，画在卡片上方 */
  title?: string
}

export type PreviewMode = 'light' | 'dark'

/**
 * 绘制上下文：一次 paint 调用的全部输入。
 *
 * el 是本层专属的 div（position:absolute; inset:0; pointer-events:none），
 * 每次重画前宿主会清空它，绘制函数不必自己 remove 旧内容。
 */
export interface PreviewPaintCtx {
  /** 画板根节点：需要量别的层或真实 DOM 时从这里查 */
  root: HTMLElement
  /** 本层自己的容器，已绝对定位铺满画板 */
  el: HTMLElement
  /** 当前画板上的全部节点矩形（flow 坐标，按 id 索引） */
  rects: Record<string, PreviewRect>
  /** 同上，但保留顺序与身份，画连线时按数组中相邻关系取端点 */
  nodes: readonly PreviewNodeRect[]
  /** 亮色 / 暗色 */
  mode: PreviewMode
  /** 读主题色：colors('accentColor')，已按 mode 解析成 hex */
  colors: (key: string) => string
  /** 读任意原始设置值（插件自己的几何/开关配置用） */
  get: (key: string) => unknown
  /** 是否允许动效（系统开了"减少动态效果"时为 false） */
  motion: boolean
  /**
   * 上报"这层画到了哪里"（画板坐标）。
   *
   * 取景要用它：节点矩形只覆盖卡片本体，标题、端口、选框、刀光都在卡片外。
   * 不上报的部分不会进入取景范围，容易被裁掉或让画面偏心。
   */
  claim?: (rect: PreviewRect) => void
}

/** 一个预览层：只有一个同步绘制函数。 */
export interface PreviewLayer {
  paint(ctx: PreviewPaintCtx): void
}

/** 默认画板：两个节点 + 一条连线的保底布局（空画布时用）。 */
export const THEME_PREVIEW_ARTBOARD: PreviewRect = { x: 0, y: 0, w: 720, h: 400 }

export const THEME_PREVIEW_NODES: readonly PreviewNodeRect[] = Object.freeze([
  { id: 'preview-a', kind: 'text', title: '灵感速记', x: 56, y: 92, w: 312, h: 224 },
  { id: 'preview-b', kind: 'image', title: '海边房间', x: 452, y: 262, w: 292, h: 184 },
])

/** 把一组矩形求并集（空数组返回 null）。 */
export function unionPreviewRect(list: readonly PreviewRect[]): PreviewRect | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const r of list) {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || r.w <= 0 || r.h <= 0) continue
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** 按 id 建索引，给绘制函数用。 */
export function indexPreviewRects(nodes: readonly PreviewNodeRect[]): Record<string, PreviewRect> {
  const out: Record<string, PreviewRect> = {}
  for (const n of nodes) out[n.id] = { x: n.x, y: n.y, w: n.w, h: n.h }
  return out
}

/** 主题色板里"可留空"的 key（清空 = 跟随强调色）。 */
const OPTIONAL_COLOR_KEYS = new Set([
  'edgeFlowColor',
  'alignGuideColor',
  'multiSelectBoxColor',
  'multiSelectFrameOuterColor',
  'multiSelectFrameInnerColor',
  'pathColor',
  'bladeColor',
])

/**
 * 读一个主题色。get 是设置读取器，mode 决定读亮格还是暗格。
 * 留空的颜色跟随强调色；读不到时返回 fallback。
 */
export function readPreviewColor(
  get: (key: string) => unknown,
  key: string,
  mode: PreviewMode,
  fallback: string,
): string {
  const suffix = mode === 'dark' ? 'Dark' : 'Light'
  const raw = get(key + suffix) ?? get(key)
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value) return value
  if (key !== 'accentColor' && OPTIONAL_COLOR_KEYS.has(key)) {
    return readPreviewColor(get, 'accentColor', mode, fallback)
  }
  return fallback
}
