/**
 * canvasInteractionSettings —— 画布交互配置（「常规/画布」）的声明与读取（纯逻辑，零 Vue / 零 DOM）。
 *
 * 背景：v1（packages/canvas-core）把 VueFlow 交互开关（可拖拽/可选中/网格吸附/滚轮缩放/框选判定…）
 * 全暴露在设置面板；v2 渲染宿主 CanvasSurface 此前只绑 minZoom/maxZoom，其余一律用 VueFlow 库默认值 ——
 * 既不能配，还有几处与 v1 行为不一致（edgesUpdatable/selectNodesOnDrag/zoomOnDoubleClick/
 * connectOnClick/onlyRenderVisibleElements）。本模块把这批开关收进一个分组，对齐 v1 默认。
 *
 * 职责与同目录 nodeLayoutSettings.ts 同一套语义：
 * - 声明：CANVAS_INTERACTION_SCHEMA（SettingsStore 的 SettingSchema 形状，宿主 define 用）；
 * - 读取：resolveCanvasInteraction（任意取值器 → 完整值对象；缺项/非法逐项回落默认）；
 * - 变更：applyCanvasInteractionChange（订阅回调里单项应用；无关键原样返回同一引用）。
 *
 * 键名注意：settings 的 key 全局平面命名、先声明者独占（撞名静默保留先者），
 * 这批是渲染宿主级配置，由 createMiniCanvasHost 在插件装载后声明（scope='canvas-render'）。
 * 键名对齐 v1 core 同名项（nodesDraggable 等），未加前缀 —— 它们语义本就唯一，
 * 且 v1 数据迁移/用户认知都按这个名字；撞名风险由"先声明者保留"兜底。
 */

/** 这批配置在设置面板里的唯一分组名（一级「常规」/ 二级「画布」） */
export const CANVAS_INTERACTION_GROUP = '常规/画布'

/** 一项画布交互配置的 schema（对齐内核 SettingSchema 的本批用到的子集） */
export interface CanvasInteractionSettingSchema {
  type: 'boolean' | 'number'
  default: boolean | number
  label: string
  description?: string
  min?: number
  max?: number
  step?: number
  /** 面板分组（恒为 CANVAS_INTERACTION_GROUP；放字段里让 schema 可整体喂给 SettingsStore.define） */
  group: string
}

/** 画布交互配置的完整值（resolve 的产出；键 = schema 键 + 聚合出的 snapGrid 元组） */
export interface CanvasInteractionSettings {
  nodesDraggable: boolean
  nodesConnectable: boolean
  elementsSelectable: boolean
  edgesUpdatable: boolean
  selectNodesOnDrag: boolean
  snapToGrid: boolean
  snapGridX: number
  snapGridY: number
  zoomOnScroll: boolean
  zoomOnPinch: boolean
  panOnScroll: boolean
  panOnDrag: boolean
  zoomOnDoubleClick: boolean
  connectOnClick: boolean
  minZoom: number
  maxZoom: number
  onlyRenderVisibleElements: boolean
  preventScrolling: boolean
  /** VueFlow 绑定用：snapGridX/Y 拼成的 [x, y] 元组 */
  snapGrid: [number, number]
}

/** 默认值（对齐 v1 core 的 core 交互段；v1 默认与库默认不同的项以 v1 为准） */
export const CANVAS_INTERACTION_DEFAULTS: Readonly<CanvasInteractionSettings> = Object.freeze({
  nodesDraggable: true,
  nodesConnectable: true,
  elementsSelectable: true,
  edgesUpdatable: true, // v1 开（VueFlow 库默认关）
  selectNodesOnDrag: false, // v1 关（VueFlow 库默认开：拖节点顺手选中）
  snapToGrid: false,
  snapGridX: 15,
  snapGridY: 15,
  zoomOnScroll: true,
  zoomOnPinch: true,
  panOnScroll: false,
  panOnDrag: true,
  zoomOnDoubleClick: false, // v1 关（VueFlow 库默认开）
  connectOnClick: false, // v1 关（VueFlow 库默认开）
  minZoom: 0.2,
  maxZoom: 2,
  onlyRenderVisibleElements: true, // v1 开（VueFlow 库默认关；大画布性能）
  preventScrolling: true,
  snapGrid: [15, 15] as [number, number],
})

/** 单项 schema（供宿主声明进 SettingsStore；group 恒为「常规/画布」） */
function bool(key: string, label: string, description?: string): CanvasInteractionSettingSchema {
  return {
    type: 'boolean',
    default: CANVAS_INTERACTION_DEFAULTS[key as keyof Omit<CanvasInteractionSettings, 'snapGrid'>] as boolean,
    label,
    ...(description ? { description } : {}),
    group: CANVAS_INTERACTION_GROUP,
  }
}

function num(
  key: keyof Omit<CanvasInteractionSettings, 'snapGrid'>,
  label: string,
  min: number,
  max: number,
  step: number,
  description?: string,
): CanvasInteractionSettingSchema {
  return {
    type: 'number',
    default: CANVAS_INTERACTION_DEFAULTS[key],
    min,
    max,
    step,
    label,
    ...(description ? { description } : {}),
    group: CANVAS_INTERACTION_GROUP,
  }
}

/** 17 项声明（宿主 createMiniCanvasHost 用 settings.define 一次登记） */
export const CANVAS_INTERACTION_SCHEMA: Record<string, CanvasInteractionSettingSchema> = {
  nodesDraggable: bool('nodesDraggable', '节点可拖拽', '关闭后节点不能拖动（画布只读平移时常用）。'),
  nodesConnectable: bool('nodesConnectable', '节点可连线', '关闭后不能从端口拖出连线。'),
  elementsSelectable: bool('elementsSelectable', '元素可选中', '关闭后节点/边不能被点选与框选。'),
  edgesUpdatable: bool('edgesUpdatable', '边可重连', '开启后可以拖动已连线的端点改接到别的端口。'),
  selectNodesOnDrag: bool('selectNodesOnDrag', '拖拽选中', '开启后拖动未选中的节点会顺手选中它（v1 默认关）。'),
  snapToGrid: bool('snapToGrid', '网格吸附', '开启后节点移动时吸附到网格，位置按网格间距取整。'),
  snapGridX: num('snapGridX', '网格间距 X', 5, 200, 1, '网格吸附的水平间距（px）；关闭吸附时不生效。'),
  snapGridY: num('snapGridY', '网格间距 Y', 5, 200, 1, '网格吸附的垂直间距（px）；关闭吸附时不生效。'),
  zoomOnScroll: bool('zoomOnScroll', '滚轮缩放', '开启后鼠标滚轮缩放画布。'),
  zoomOnPinch: bool('zoomOnPinch', '双指缩放', '开启后触控板捏合/双指滑动缩放画布。'),
  panOnScroll: bool('panOnScroll', '滚轮平移', '开启后滚轮平移画布（与滚轮缩放互斥使用更合理，同开以缩放优先）。'),
  panOnDrag: bool('panOnDrag', '拖拽平移', '开启后按住空白处拖动平移画布。'),
  zoomOnDoubleClick: bool('zoomOnDoubleClick', '双击缩放', '开启后双击空白处放大画布（v1 默认关）。'),
  connectOnClick: bool('connectOnClick', '点击连线', '开启后依次点击两个端口即可连线（v1 默认关，拖拽连线不受影响）。'),
  minZoom: num('minZoom', '最小缩放', 0.05, 2, 0.05, '画布能缩小到的下限（0.2 = 缩到 20%）。'),
  maxZoom: num('maxZoom', '最大缩放', 1, 8, 0.5, '画布能放大到的上限（2 = 放大到 200%）。'),
  onlyRenderVisibleElements: bool(
    'onlyRenderVisibleElements',
    '只渲染可见元素',
    '开启后视口外的节点/边不渲染（大画布更流畅；v1 默认开）。',
  ),
  preventScrolling: bool(
    'preventScrolling',
    '阻止页面滚动',
    '鼠标在画布上滚动时不带动外层页面滚动（嵌入长页面时按需关）。',
  ),
}

/** 把任意值收敛成合法布尔（非法回落默认） */
function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 把任意值收敛成合法数字（非法/越界回落默认；SettingsStore.set 本身会夹取，这里防"旁路写入的坏值"） */
function toNum(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < min) return fallback
  if (value > max) return fallback
  return value
}

/** schema 键（解析与应用共用一份键表，避免两处手抄漂移） */
const SCHEMA_KEYS = Object.keys(CANVAS_INTERACTION_SCHEMA) as Array<keyof typeof CANVAS_INTERACTION_SCHEMA>

/** number 项的边界表（resolve/apply 共用；来自 schema 本身，避免再抄一遍 min/max） */
function boundsOf(key: string): { min: number; max: number } {
  const s = CANVAS_INTERACTION_SCHEMA[key]
  return { min: s.min ?? -Infinity, max: s.max ?? Infinity }
}

/**
 * 从任意取值器解析出完整交互配置（纯函数）。
 * 缺项/非法值逐项回落默认 —— 一项坏了不影响其它项。
 */
export function resolveCanvasInteraction(get: (key: string) => unknown): CanvasInteractionSettings {
  const d = CANVAS_INTERACTION_DEFAULTS
  const out: CanvasInteractionSettings = { ...d }
  for (const key of SCHEMA_KEYS) {
    const raw = get(key)
    if (raw === undefined) continue
    const schema = CANVAS_INTERACTION_SCHEMA[key]
    const fallback = d[key as keyof CanvasInteractionSettings]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(out as any)[key] =
      schema.type === 'boolean'
        ? toBool(raw, fallback as boolean)
        : toNum(raw, fallback as number, boundsOf(key).min, boundsOf(key).max)
  }
  out.snapGrid = [out.snapGridX, out.snapGridY]
  return out
}

/**
 * 应用"某一项配置被改动"到当前值（纯函数；订阅回调里唯一那点逻辑）。
 * 只认识的键才动（新对象）；其余键（其它插件的配置）原样返回同一引用 —— 不触发无谓重渲染。
 */
export function applyCanvasInteractionChange(
  current: CanvasInteractionSettings,
  key: string,
  value: unknown,
): CanvasInteractionSettings {
  if (!(key in CANVAS_INTERACTION_SCHEMA)) return current
  const next = resolveCanvasInteraction((k) =>
    k === key ? value : (current as unknown as Record<string, unknown>)[k],
  )
  return next
}
