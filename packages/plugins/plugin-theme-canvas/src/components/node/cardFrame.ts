/**
 * cardFrame —— 卡片边框 / 选中环 / 圆角的取值规则（纯函数，零 Vue / 零 DOM，Node 可单测）。
 *
 * 为什么要单独一层：这三件事都是"屏幕上的视觉量"，而画布会缩放 ——
 * 宽度必须写成 `1px ÷ zoom` 才能在屏幕上恒为 1px（反向缩放）。再加上
 * "有的类型不要边框（frameless）"这条能力，就变成一张需要判断的小表，
 * 写在 computed 里只能靠肉眼，抽出来就能在 Node 里直接断言（含"删边框别把选中环删没了"这条回归）。
 *
 * 边框从哪来（回答"为什么图片会长出边框"）：它是**共享外壳**给所有节点类型的默认外观，
 * 本意是让卡片从画布背景上浮起来 + 承载选中/非法连接的边框高亮。
 * 对内容铺满整张卡的类型（图片）它只是多余的一圈缝，所以那些类型声明 frameless 关掉它。
 */

/** 卡片外观取值输入 */
export interface CardFrameInput {
  /** 当前画布缩放（viewport.zoom） */
  zoom: number
  /** 该类型是否声明了"不要卡片边框"（nodeStore.types[type].frameless） */
  frameless: boolean
  /** 该类型是否声明了"卡片表面透明"（nodeStore.types[type].transparent；容器型类型如分组） */
  transparent?: boolean
  /** 当前是否选中（选中才画外圈环） */
  selected: boolean
}

/** 卡片外观取值结果（直接可拼进 CSS） */
export interface CardFrame {
  /** 盒子自身的 border 宽度 —— 恒为 0：边框改由外扩 ring 画，覆盖层盖不到 */
  borderWidth: string
  /** 外扩边框（ring）宽度：屏幕上恒 1px；frameless 类型为 0 */
  ringWidth: string
  /** 外扩边框颜色：frameless 类型透明 */
  ringColor: string
  borderRadius: string
  /** 选中环宽度（走 --card-outline-width，由 .v2-card::after 消费） */
  outlineWidth: string
  /** 卡片底色变量值（transparent 类型给 transparent，让连接线透出卡片区域） */
  surface: string
  /** 卡片投影变量值（transparent 类型给 none；半透明色块上投影会脏） */
  shadow: string
  /** 内容裁剪层底色变量值（transparent 类型给 transparent —— 否则 content-clip 的 #eee 兜底底色照样遮线） */
  contentSurface: string
}

/** 卡片圆角：固定 8px（与 ui-style-guide 的圆角阶梯一致） */
export const CARD_RADIUS = '8px'

/** 屏幕上 1px 的边框 / 2px 的选中环（都要按缩放反算） */
const BORDER_PX = 1
const OUTLINE_PX = 2

/** 缩放非法（0 / 负数 / NaN）时按 1 算 —— 否则会写出 `1/0px` 这种坏 CSS，整条声明失效 */
function safeZoom(zoom: number): number {
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}

/** 按缩放反算"屏幕上 n 像素"对应的 CSS 长度 */
function screenPx(px: number, zoom: number): string {
  return `${px / safeZoom(zoom)}px`
}

/**
 * 算出卡片的边框 / 圆角 / 选中环宽度。
 *
 * - frameless 的类型边框恒为 `0px`（内容贴边，不留那一圈缝）；
 * - 选中环与边框**互相独立**：环是外圈 box-shadow，不吃盒模型，
 *   所以去掉边框后图片节点选中照样看得见（这是删边框时最该防的回归）。
 * - 边框画在独立轮廓层（`.v2-frame`，节点最后一个子层）上，卡片本体 border 恒为 0：
 *   边框必须最后绘制、层级高于内容与覆盖层，否则一定会在边缘和圆角被盖住。
 */
export function resolveCardFrame(input: CardFrameInput): CardFrame {
  return {
    // border 恒为 0：盒子尺寸完全交给 node.size，边框以 ring 的形式画在外面
    borderWidth: '0px',
    ringWidth: input.frameless ? '0px' : screenPx(BORDER_PX, input.zoom),
    ringColor: input.frameless ? 'transparent' : 'var(--canvas-node-border, rgb(209 213 219 / 0.95))',
    borderRadius: CARD_RADIUS,
    outlineWidth: input.selected ? screenPx(OUTLINE_PX, input.zoom) : '0px',
    surface: input.transparent ? 'transparent' : 'var(--canvas-node-surface, #f9fafb)',
    shadow: input.transparent ? 'none' : '0 1px 3px var(--canvas-node-shadow-subtle, rgb(0 0 0 / 0.06))',
    contentSurface: input.transparent ? 'transparent' : 'var(--canvas-node-panel-surface, #eee)',
  }
}
