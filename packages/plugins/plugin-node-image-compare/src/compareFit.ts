/**
 * compareFit —— 图片对比节点的「宽度跟随第一条连线的图片」（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户要求（原话）：「优化你的图片对比节点，他的宽度应该跟第一个连接线连接的图片的宽度一致」。
 *
 * 为什么要跟随：对比节点的意义是「把两张图叠在一起看差别」，两边图片像素能对齐才有意义。
 * 上游图片节点显示多大，对比窗口就该一样大 —— 否则用户看到的是被拉伸或压缩过的对照，反而误导判断。
 *
 * 三个约定（都写在这里，免得调用点各猜一遍）：
 *
 * 1. 只看**第一条连线**（左边那张）的宽度。两张图宽度不同时以先连的为准，符合「以第一个为准」的原话。
 * 2. 宽度来源是上游图片节点的**显示宽度** data.cardWidth（图片插件在上传/换图/裁剪/生成后都会写它，
 *    就是用户实际看到的那个宽度）。拿不到就**不猜**，保持对比节点当前宽度不动 ——
 *    猜错比不跟随更糟：卡片会莫名其妙跳成一个别的尺寸。
 * 3. **幂等**：算出来与当前一致就返回 null，一次都不写。这条是硬要求 ——
 *    我们写回宽度会触发自己的监听，不做这个判断就会「自己触发自己」转成死循环
 *    （与 plugin-node-image 的 imageFit 同一个教训）。
 *
 * 只改宽度、不动高度：用户只要求宽度对齐，高度留给用户自己拖（本类型声明了 resizable）。
 */

/** 宽度下限：与 theme-default 的卡片拖拽下限同值，不会跟随出比这更窄的卡片 */
export const MIN_COMPARE_WIDTH = 120

/** 跟随用的最小输入：只需要「第一条入边来自哪个上游节点」 */
export interface WidthSourceEntry {
  sourceId: string
}

/** 只认正有限数；其余（undefined / NaN / 0 / 负数 / 字符串）一律视为「拿不到」 */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 算出对比节点该用的宽度（第一条入边那张图的显示宽度）。
 *
 * @param entries      连到本节点的图片条目（按连线先后；只取第一条）
 * @param getCardWidth 按上游节点 id 取它的**显示宽度**（图片节点的 data.cardWidth）
 * @returns 目标宽度（取整、不低于下限）；拿不到就 null（调用方保持原宽度不动）
 */
export function resolveFollowWidth(
  entries: ReadonlyArray<WidthSourceEntry>,
  getCardWidth: (nodeId: string) => unknown,
): number | null {
  const first = entries[0]
  if (!first) return null
  const width = positive(getCardWidth(first.sourceId))
  if (width === null) return null
  return Math.max(MIN_COMPARE_WIDTH, Math.round(width))
}

/**
 * 是否该把宽度写回：算得出目标宽度、且与当前不一致时才写。
 * 与当前一致 → null（幂等，避免自己触发自己）。
 *
 * @param currentWidth 当前宽度（data.cardWidth）
 */
export function followedWidthPatch(targetWidth: number | null, currentWidth: unknown): number | null {
  if (targetWidth === null) return null
  if (positive(currentWidth) === targetWidth) return null
  return targetWidth
}

/** 写回补丁：卡片渲染读 data.cardWidth，内核正式尺寸字段是 size —— 两者必须同一次提交 */
export interface CompareWidthPatch {
  cardWidth: number
  size: { w: number; h: number }
}

/** 类型默认高度（跟随宽度时高度保持不变；连高度也拿不到时用它兜底） */
export const DEFAULT_COMPARE_HEIGHT = 320

/**
 * 把「目标宽度」拼成一次写回的补丁（cardWidth + size 一起给）。
 *
 * 为什么 size 也要给：卡片宽度有两个存放处 —— data.cardWidth 是渲染真正读的那个，
 * node.size 是内核的正式尺寸字段（布局与相连边端点用）。只改一个会出现「卡片变了、
 * 但边的端点还画在旧宽度上」（与 image 包 resize 时同一次提交两份尺寸是同一条规矩）。
 * 高度原样带过来，保持用户拖过的高度不变。
 *
 * @param data 对比节点当前 data（读 cardHeight）
 * @param fallbackHeight 从 data 里拿不到高度时的兜底（通常是类型默认高度）
 */
export function compareWidthPatch(
  targetWidth: number | null,
  data: Record<string, unknown> | undefined,
  fallbackHeight: number = DEFAULT_COMPARE_HEIGHT,
): CompareWidthPatch | null {
  const width = followedWidthPatch(targetWidth, data?.cardWidth)
  if (width === null) return null
  const height = positive(data?.cardHeight) ?? positive(fallbackHeight) ?? DEFAULT_COMPARE_HEIGHT
  return { cardWidth: width, size: { w: width, h: Math.round(height) } }
}
