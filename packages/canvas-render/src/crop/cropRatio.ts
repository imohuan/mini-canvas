/**
 * cropRatio —— 裁剪框的比例（宽高比）策略（纯函数，零 DOM / 零 Vue，Node 可单测）。
 *
 * 用户要求：「在中间添加一个下拉配置，可以选择当前的裁剪框的比例，设置比例之后，
 * 你的裁剪框长宽比就会进行对应变化」。所以这里把「比例」这件事单独收一层。
 *
 * 两个决定值得说明：
 *
 * 1. **"自由"必须保留**。用户可能是想随手框一块，不强加比例。默认值也是自由 ——
 *    默认锁成某个比例会让"框住这块内容"这个最朴素的动作变得别扭。
 *
 * 2. **换比例时框的"中心"不动、只改尺寸**，而不是把框挪到某个角。用户的注意力在
 *    画面中央那块内容上，锚在中心最不容易"我框的东西跑掉了"。改完再按边界收敛，
 *    保证永远不越界、也不小于最小边。
 */
import type { Rect } from './mediaFit'

/** 比例选项：value 是稳定的字符串键，ratio 是宽/高（null = 自由） */
export interface CropRatioOption {
  /** 稳定键（写进 UI 的选中值；与具体数值解耦，方便日后调整比例数值） */
  value: string
  /** 显示名 */
  label: string
  /** 宽 / 高；null = 自由（不锁比例） */
  ratio: number | null
}

/** 内置比例表（常见的构图习惯：原图、正方形、竖版、横版） */
export const CROP_RATIO_OPTIONS: CropRatioOption[] = [
  { value: 'free', label: '自由', ratio: null },
  { value: '1:1', label: '1:1', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:4', label: '3:4', ratio: 3 / 4 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: '9:16', ratio: 9 / 16 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '2:3', label: '2:3', ratio: 2 / 3 },
]

/** 默认比例：自由（不锁） */
export const DEFAULT_CROP_RATIO_VALUE = 'free'

/** 按 value 找比例；找不到 / 非法 → null（视为自由），调用方据此不锁比例 */
export function ratioOf(value: string | undefined): number | null {
  if (!value) return null
  const opt = CROP_RATIO_OPTIONS.find((o) => o.value === value)
  if (!opt) return null
  const r = opt.ratio
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null
}

/**
 * 把框调成指定比例（**中心不动**）。
 *
 * 三条必须同时成立（每条都有对应的实测/推理依据）：
 * 1. **结果的比例精确等于所选比例**。这是最易错的一条：不能"算好尺寸再交给通用夹取函数" ——
 *    夹取是逐边独立的，宽度被画面边界挡住时高度不会跟着缩，比例当场就破了
 *    （实测：选 16:9 却得到 800×480 = 1.67）。所以尺寸超界时必须**等比缩小**。
 * 2. **中心不动**。用户的注意力在画面中央那块内容上，锚在中心才不容易"我框的东西跑掉了"。
 * 3. 结果仍然不小于最小边（不然切极端比例会塌成一条线）。
 *
 * 基准取现有框的**短边**（不是长边）：保证换比例后不会突然"膨胀"把整幅画面盖住。
 *
 * @param rect     当前裁剪框（媒体像素）
 * @param ratio    目标宽/高；null = 自由（原样返回，不做任何改动）
 * @param bounds   画面尺寸与最小边（媒体像素）—— 比例调整只用于裁剪，边界就是整幅画面
 * @returns 新框；ratio 为 null 或非法时返回原框
 */
export function applyRatio(
  rect: Rect,
  ratio: number | null,
  bounds: { width: number; height: number; minEdge?: number },
): Rect {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return rect
  if (!(rect.width > 0) || !(rect.height > 0)) return rect

  const maxW = bounds.width > 0 ? bounds.width : rect.width
  const maxH = bounds.height > 0 ? bounds.height : rect.height
  const minEdge = bounds.minEdge && bounds.minEdge > 0 ? bounds.minEdge : 1

  // ① 以短边为基准算出目标尺寸
  const shortSide = Math.min(rect.width, rect.height)
  let width = ratio >= 1 ? shortSide * ratio : shortSide
  let height = ratio >= 1 ? shortSide : shortSide / ratio

  // ② 超界就**等比**缩到装得下（这一步是"比例精确正确"的关键，见上面第 1 条）
  const fitScale = Math.min(1, maxW / width, maxH / height)
  width *= fitScale
  height *= fitScale

  // ③ 不小于最小边（同样等比放大，保持比例）
  const minScale = Math.max(1, minEdge / width, minEdge / height)
  if (minScale > 1) {
    width *= minScale
    height *= minScale
  }

  // ④ 中心不动，再把位置夹回画面内（尺寸已合法，夹位置不会破坏比例）
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const x = Math.min(Math.max(cx - width / 2, 0), Math.max(0, maxW - width))
  const y = Math.min(Math.max(cy - height / 2, 0), Math.max(0, maxH - height))
  return { x, y, width, height }
}
