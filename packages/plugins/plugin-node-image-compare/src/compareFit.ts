/**
 * compareFit —— 图片对比节点的「尺寸跟随第一条连线的图片」（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户要求（原话）：「优化你的图片对比节点，他的宽度应该跟第一个连接线连接的图片的宽度一致」；
 * 2026-10-30 加码：「图片对比改为根据第一张图片的一个比例进行固定比例缩放」——
 * 所以跟随不再只对宽度，高度也按第一张图的比例一起算，把比例存进节点 data，
 * 供类型注册处的 resizeRatio 在等比拖拽时读（内容变了比例跟着变，不用用户手动改）。
 *
 * 为什么要跟随：对比节点的意义是「把两张图叠在一起看差别」，两边图片像素能对齐才有意义。
 * 上游图片节点显示多大，对比窗口就该一样大 —— 否则用户看到的是被拉伸或压缩过的对照，反而误导判断。
 *
 * 三个约定（都写在这里，免得调用点各猜一遍）：
 *
 * 1. 只看**第一条连线**（左边那张）的尺寸。两张图尺寸不同时以先连的为准，符合「以第一个为准」的原话。
 * 2. 宽高来源是上游图片节点的**显示尺寸** data.cardWidth / data.cardHeight（图片插件在
 *    上传/换图/裁剪/生成后都会写，就是用户实际看到的那个）。宽高任一拿不到就**不猜**，
 *    保持对比节点当前尺寸不动 ——
 *    猜错比不跟随更糟：卡片会莫名其妙跳成一个别的尺寸。
 * 3. **幂等**：算出来与当前一致就返回 null，一次都不写。这条是硬要求 ——
 *    我们写回宽度会触发自己的监听，不做这个判断就会「自己触发自己」转成死循环
 *    （与 plugin-node-image 的 imageFit 同一个教训）。
 *
 * 高度不再独立：固定比例缩放 = 高度按第一张图的比例回算，用户手动拖宽或高等比生效。
 */

/** 宽度下限：与 theme-default 的卡片拖拽下限同值，不会跟随出比这更窄的卡片 */
export const MIN_COMPARE_WIDTH = 120

/** 跟随用的最小输入：只需要「第一条入边来自哪个上游节点」 */
export interface WidthSourceEntry {
  sourceId: string
}

/** 对比节点 data 里存的比例字段名（第一张图的显示宽/高比，供 resizeRatio 读） */
export const FOLLOW_RATIO_KEY = 'followRatio'

/** 只认正有限数；其余（undefined / NaN / 0 / 负数 / 字符串）一律视为「拿不到」 */
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 算出对比节点该用的目标尺寸与比例（第一条入边那张图的显示宽高）。
 *
 * @param entries      连到本节点的图片条目（按连线先后；只取第一条）
 * @param getCardSize  按上游节点 id 取它的**显示宽高**（图片节点的 data.cardWidth/cardHeight）
 * @returns 目标宽、目标高、比例（取整宽、高度随比例回算取整；宽取卡片下限）
 *          任何一项拿不到就 null（调用方保持原尺寸不动）
 */
export function resolveFollowSize(
  entries: ReadonlyArray<WidthSourceEntry>,
  getCardSize: (nodeId: string) => { w: unknown; h: unknown },
): { w: number; h: number; ratio: number } | null {
  const first = entries[0]
  if (!first) return null
  const size = getCardSize(first.sourceId)
  const w = positive(size.w)
  const h = positive(size.h)
  if (w === null || h === null) return null
  const width = Math.max(MIN_COMPARE_WIDTH, Math.round(w))
  const ratio = w / h
  const height = Math.max(1, Math.round(width / ratio))
  return { w: width, h: height, ratio }
}

/**
 * 是否该把尺寸写回：算得出目标尺寸、且与当前不一致时才写。
 * 宽高都一致 → null（幂等，避免自己触发自己）。
 *
 * @param currentW 当前宽度（data.cardWidth）
 * @param currentH 当前高度（data.cardHeight）
 */
export function followedSizePatch(
  target: { w: number; h: number; ratio: number } | null,
  currentW: unknown,
  currentH: unknown,
): boolean {
  if (target === null) return false
  return positive(currentW) !== target.w || positive(currentH) !== target.h
}

/** 写回补丁：size 是正式字段（唯一正身，卡片镜像由 nodeStore 自动补齐）；比例走 data 合并 */
export interface CompareFollowPatch {
  size?: { w: number; h: number }
  data: Record<string, unknown>
}

/** 类型默认高度（连不上图时的初始尺寸；跟随链路不再单独用它） */
export const DEFAULT_COMPARE_HEIGHT = 320

/**
 * 把「目标尺寸 + 比例」拼成一次写回的补丁（size 与 data 里的比例一起写）。
 *
 * 为什么只给 size：宽度过去要同时写 data.cardWidth 与 node.size 两份，漏一个就出现
 * 「卡片变了、但边的端点还画在旧宽度上」。现在镜像由 nodeStore 从 size 统一生成。
 *
 * @param data 对比节点当前 data（读 cardWidth/cardHeight 与已存比例）
 * @returns null = 幂等（尺寸与比例都没变，一次都不写）
 */
export function compareFollowPatch(
  target: { w: number; h: number; ratio: number } | null,
  data: Record<string, unknown> | undefined,
): CompareFollowPatch | null {
  if (target === null) return null
  const changed = followedSizePatch(target, data?.cardWidth, data?.cardHeight)
  const ratioChanged = !data || typeof data[FOLLOW_RATIO_KEY] !== 'number' || !Number.isFinite(data[FOLLOW_RATIO_KEY] as number) || Math.abs((data[FOLLOW_RATIO_KEY] as number) - target.ratio) > 1e-9
  if (!changed && !ratioChanged) return null
  // 尺寸本身没变（只有比例字段脏/缺）→ 不带 size，避免无谓的一次写
  const patch: { size?: { w: number; h: number }; data: Record<string, unknown> } = {
    data: { [FOLLOW_RATIO_KEY]: target.ratio },
  }
  if (changed) patch.size = { w: target.w, h: target.h }
  return patch
}
