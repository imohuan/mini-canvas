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
  /** 当前是否选中（选中才画外圈环） */
  selected: boolean
}

/** 卡片外观取值结果（直接可拼进 CSS） */
export interface CardFrame {
  borderWidth: string
  borderRadius: string
  /** 选中环宽度（走 --card-outline-width，由 .v2-card::after 消费） */
  outlineWidth: string
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
 * - 选中环与边框**互相独立**：环是 `.v2-card::after` 的 box-shadow，不吃盒模型，
 *   所以去掉边框后图片节点选中照样看得见（这是删边框时最该防的回归）。
 */
export function resolveCardFrame(input: CardFrameInput): CardFrame {
  return {
    borderWidth: input.frameless ? '0px' : screenPx(BORDER_PX, input.zoom),
    borderRadius: CARD_RADIUS,
    outlineWidth: input.selected ? screenPx(OUTLINE_PX, input.zoom) : '0px',
  }
}
