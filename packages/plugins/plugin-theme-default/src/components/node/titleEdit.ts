/**
 * titleEdit —— 标题就地改名的纯逻辑（零 DOM，可单测）。
 *
 * 抽出来的两个判断都有一个具体的坑：
 * - normalizeTitleText：标题是**单行**。contenteditable 下粘贴/输入多行内容会让元素长出第二行，
 *   行高被撑破、标题条变形。统一把换行与连续空白收敛成单个空格。
 * - isRectFullyVisible：进编辑时"适当聚焦"——只在节点没完整露在视野里才挪视图，
 *   否则用户每次双击改名画布都跳一下，很烦。
 */

/**
 * 标题元素此刻该显示的文本。
 * - 编辑中 → 草稿（用户正在打的内容；重渲染/重挂载都不能把它抹掉）
 * - 非编辑态 → 外部 label（props.label）
 *
 * 抽成纯函数是为了让"编辑期间不被外部 label 覆盖"这条规则可单测 —— 它是本组件最容易写错的地方。
 */
export function resolveTitleText(
  editing: boolean,
  label: string | undefined,
  draft: string,
): string {
  return editing ? draft : label ?? ''
}

/**
 * 标题文本归一化为单行：
 * - 换行(\n/\r)、制表符、连续空白、&nbsp;(\u00a0) 一律收敛成一个半角空格；
 * - 去首尾空白；
 * - 全空白 → 空串（调用方据此清掉自定义标题）。
 */
export function normalizeTitleText(raw: string): string {
  return raw.replace(/[\s\u00a0]+/g, ' ').trim()
}

/**
 * 矩形是否完整落在可视区内（决定进编辑时要不要挪视图）。
 * @param pad 预留余量（正数 = 要求四周多留这么多，边缘贴太近也算不可见）。
 *            标题浮在卡片**上方**，所以调用方通常传正数留出标题自身的空间。
 */
export function isRectFullyVisible(
  rect: { x: number; y: number; w: number; h: number },
  view: { x: number; y: number; w: number; h: number },
  pad = 0,
): boolean {
  return (
    rect.x >= view.x + pad &&
    rect.y >= view.y + pad &&
    rect.x + rect.w <= view.x + view.w - pad &&
    rect.y + rect.h <= view.y + view.h - pad
  )
}
