/**
 * textSkeleton —— 文本节点「缩略横条（骨架屏）」的几何纯逻辑（零 Vue / 零 DOM，Node 可单测）。
 *
 * 用户口径（原话）：
 * 「他这边不是有一个断点吗？就是当鼠标缩放到一定程度下，文本会发生一些改变。我希望你可以
 *  改变成图片中的这种形式，使用不同长度的矩形色块。这个有点像那种什么屏来着。」
 * —— 那个词是**骨架屏 skeleton screen**：用长短不一的灰条把一段文字"画"成版式剪影。
 *
 * 追问「横条显示几行 / 长短怎么定」→「两档都改成横条」「你看它在大屏中怎样展示，
 * 在小屏中做一个相似的就行……它有多少行也是这个样子」。
 *
 * 后续三条观感修正（2026-10-14）：
 * ① 「如果色块非常短，少于整个宽度的 50%，就不显示」；
 * ② 「但是这个换行你依然保留 —— 就相当于这一行它不显示内容，但保留」；
 * ③ 「这边开头就不要留下这种空白，这样不美观 …… 你要不小于 50%，直接按 50% 的一个宽度来做，
 *    小于 10% 就直接隐藏掉」（看图：短行被整段藏掉，开头留了一块空洞）。
 *
 * ③ 覆盖了 ①：短行不再留空，而是**顶到 50% 宽照画**（最短也是一条看得见的块）；
 * 真短到 10% 以下才藏（那时连"半条"都不值得表现）。② 的空行保留仍然有效 —— 空行没有
 * 文字可画，宽度记 0、行位留着。
 *
 * 所以本模块的产物是**行的列表**，不是"条的列表"：每一行都占一个行位，只是有些行不画条。
 * 这样"不显示内容"的行不会把下面的行往上顶 —— 缩略出来的版式与真实文本仍然逐行对得上。
 *
 * 为什么抽成纯函数：折行、裁剪、留空、起伏是"看代码看不出对不对"的那一类判定，
 * 放 Node 里直接断言几乎零成本；写在 .vue 的 computed 里就只能靠肉眼。
 */

/**
 * 一条占位"行"：宽度用**百分比**（组件按该比例铺开）。
 *
 * widthPercent 为 0 是**空行**：这一行不画条，但行位照留（用户口径②"换行依然保留"）。
 */
export interface SkeletonBar {
  /** 相对可用宽度的百分比（0 = 空行，不画条但占行位）；画出来的条在 50 ~ 100 之间 */
  widthPercent: number
}

/** 横条的两档密度：body = 贴近真实文字的排布；mini = 缩得更小后更薄更密的排布 */
export type SkeletonDensity = 'body' | 'mini'

/** 算横条需要的输入 */
export interface SkeletonInput {
  /** 文本原文 */
  text: unknown
  /** 内容区可用宽度（px，已扣掉内边距） */
  width: number
  /** 内容区可用高度（px，已扣掉内边距） */
  height: number
  /** 档位（默认 body）：只影响"条多厚、行距多大"，不改行数与宽度比例 */
  density?: SkeletonDensity
  /** 估算换行用的字号（px，默认 14 = 正文尺寸） */
  fontSize?: number
  /** 行数上限（缩得很小时行数太多会糊成一片，所以要收口） */
  maxBars?: number
}

/** 一档横条的几何（单位 = 卡片局部 px，随画布缩放一起变大变小） */
export interface SkeletonMetrics {
  /** 一个"行盒"的高度（px）：横条的节拍 —— 第 n 条的中心在 n × pitch */
  pitch: number
  /** 横条本身的厚度（px） */
  barHeight: number
  /** 条与条之间的空隙（px） */
  gap: number
  /** 圆角（px）：条厚的一小部分，做出"色块"而不是"细线"的观感 */
  radius: number
}

/**
 * 横条的宽度下限：比它窄的行**顶到这条线照画**。
 *
 * 用户口径（2026-10-14 第三次修正）：「你要不小于 50%，直接按 50% 的一个宽度来做」——
 * 从前"少于 50% 就不显示"会把开头整段留成空洞（用户截图指出的那块空白），
 * 现在短行照样画，只是不短于半行宽。
 */
export const MIN_BAR_WIDTH_PERCENT = 50

/**
 * 短到这条线以下才真的**不画**（行位照留）。
 *
 * 用户口径（2026-10-14）：「小于 10% 就直接隐藏掉」—— 只有一两个字的行顶到 50% 会显得
 * 像多出来一块，10% 以下直接留白更干净；介于 10%~50% 之间的一律按 50% 画。
 */
export const HIDE_BAR_BELOW_PERCENT = 10

/** 估算换行用的字号（与正文一致：14px） */
export const SKELETON_FONT_SIZE = 14

/** 两档密度参数：pitch 是节拍、barHeight 是条厚（gap / radius 由它们派生） */
const DENSITIES: Record<SkeletonDensity, { pitch: number; barHeight: number }> = {
  // 大屏档：与真实正文同尺度（14px × 1.5 = 21 行高，条占 12）
  body: { pitch: 21, barHeight: 12 },
  // 小屏档：更薄更密（条 9、节拍 13）—— 缩得小时同样的高度能装下更多行，看着更像一段文字
  mini: { pitch: 13, barHeight: 9 },
}

/** 行数上限默认值：再多就糊成一片灰了 */
const DEFAULT_MAX_BARS = 14

/**
 * 条与条之间的"层次感"：按下标循环把每条缩到自然长度的 80%~100%（总起伏 20%）。
 *
 * 用户口径（2026-10-14）：「其他色块保持 20% 的层次感（这是为了效果，太平了也不好）」——
 * 真实文本里大多数行都是满行，直接照实画出来就是一叠等长条，看着像一块灰板。
 * 这里按固定循环给每条一点长短起伏，整块版式就有"一层一层"的观感。
 *
 * 为什么用固定循环而不是随机数：渲染必须可复现 —— SSR 断言、快照、同一份内容每次渲染
 * 都得长一样；而这种"像手写的一小段话"的观感，本来也不需要真随机。
 */
const WIDTH_TEXTURE = [1, 0.86, 0.96, 0.8, 0.92, 0.87, 1, 0.84, 0.98, 0.89, 0.94, 0.82, 1]

/** 由档位算出"节拍 / 条厚 / 空隙 / 圆角"（组件拿它对 CSS，测试拿它断言行数） */
export function resolveSkeletonMetrics(density: SkeletonDensity = 'body'): SkeletonMetrics {
  const spec = DENSITIES[density] ?? DENSITIES.body
  const pitch = spec.pitch
  const barHeight = spec.barHeight
  return { pitch, barHeight, gap: pitch - barHeight, radius: round2(barHeight * 0.35) }
}

/**
 * 中英文混排下的"视觉宽度"估算。
 *
 * 为什么不按"字符个数"平均分：一行里"中文 20 个字"和"英文 60 个字母"占的宽度差一倍多。
 * 这里给每个字符一个相对宽度（中文/全角 = 1，ASCII 窄字符 = 0.55），再乘字号估算像素宽。
 * 目的不是精确排版（骨架屏本来就不要求精确），而是让"哪一行更长"与真实文本**方向一致**；
 * 顺带也让固定宽度卡片里的**行数**与真实换行一致（14px 下 20 个汉字占 280px）。
 */
function visualWidthPx(ch: string, fontSize: number): number {
  const code = ch.codePointAt(0) ?? 0
  return (code <= 0x2e80 ? 0.55 : 1) * fontSize
}

/**
 * 把文本折成"每行多长"的列表（只算长度，不真排字）。
 *
 * 折行口径：
 * - 遇到换行符 → 强制断行（用户敲的回车要在缩略里留痕）；
 * - 空行 → 记 0（长度 0 的行在下面会成为一个"空行位"）；
 * - 超宽 → 按视觉宽度切（切点不看单词边界：骨架屏要的是版式剪影，不是精确排版）。
 */
export function wrapTextToLineWidths(text: string, width: number, fontSize: number): number[] {
  const usable = Math.max(width, 1)
  const out: number[] = []
  for (const raw of text.split('\n')) {
    if (raw.length === 0) {
      out.push(0)
      continue
    }
    let current = 0
    for (const ch of raw) {
      const w = visualWidthPx(ch, fontSize)
      if (current > 0 && current + w > usable) {
        out.push(current)
        current = w
      } else {
        current += w
      }
    }
    out.push(current)
  }
  return out.length > 0 ? out : [0]
}

/**
 * 算出缩略该怎么画：**每一行都产出一个行位**，行数与宽度比例只由真实文本决定。
 *
 * 三道处理，顺序是刻意的：
 * 1. 行数按**可用高度**裁（"塞满了就停"最像真实排版被裁掉的样子）；被裁过时把最后一个整行
 *    收短来示意"下面还有内容"。
 * 2. 线条宽度：**短行顶到 50% 照画**（口径③："你要不小于 50%，直接按 50% 的一个宽度来做"），
 *    短到 10% 以下才不画（口径③："小于 10% 就直接隐藏掉"），空行也不画 —— 这两种情况
 *    **行位留着**（口径②："换行依然保留……这一行它不显示内容，但保留"），产出里那条宽度记 0，
 *    组件据此只跳过"画那根条"，不跳过整个行位。
 * 3. 画出来的条叠 80%~100% 的长短起伏（口径：其他色块保持 20% 的层次感，太平了不好看）。
 *    先定宽窄、后叠起伏：同一行文字才不会因为"刚好排在纹理循环里第几个"而忽隐忽现。
 *
 * 返回空数组 = 一行都放不下（调用方据此回落成一块小色块）；返回全是 0 宽度 = 行位有、但都是
 * 空行或不值得表现的超短行（同样按"没内容可画"处理）。
 */
export function buildSkeletonBars(input: SkeletonInput): SkeletonBar[] {
  const { text } = input
  if (typeof text !== 'string' || text.trim().length === 0) return []

  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : 0
  const height = Number.isFinite(input.height) && input.height > 0 ? input.height : 0
  if (width <= 0 || height <= 0) return []

  const fontSize =
    typeof input.fontSize === 'number' && Number.isFinite(input.fontSize) && input.fontSize > 0
      ? input.fontSize
      : SKELETON_FONT_SIZE
  const { pitch, gap } = resolveSkeletonMetrics(input.density)
  const maxBars = Math.floor(
    typeof input.maxBars === 'number' && Number.isFinite(input.maxBars) && input.maxBars > 0
      ? input.maxBars
      : DEFAULT_MAX_BARS,
  )

  // 能放几行：每行占一个行盒，最后一行不需要再留行距 → (height + gap) / pitch
  const fit = Math.floor((height + gap) / pitch)
  const maxLines = Math.max(Math.min(fit, maxBars), 0)
  if (maxLines <= 0) return []

  const lineWidths = wrapTextToLineWidths(text, width, fontSize)
  const visible = lineWidths.slice(0, maxLines)
  const truncated = lineWidths.length > maxLines

  return visible.map((lineWidth, index) => {
    let percent = (lineWidth / width) * 100
    // 最后一行 + 后面还有内容 → 收短示意"未完"
    if (truncated && index === visible.length - 1) percent = shortenForTruncation(percent)
    // 空行（0）与短到 10% 以下的行 → 不画条，但行位照留
    if (percent < HIDE_BAR_BELOW_PERCENT) return { widthPercent: 0 }
    // 其余一律不短于 50%（短行顶到线，长行叠起伏）
    return { widthPercent: resolveDrawnWidth(percent, index) }
  })
}

/** 真画出来的条有几条（空行位不算） */
export function drawnBarCount(bars: SkeletonBar[]): number {
  return bars.filter((bar) => bar.widthPercent > 0).length
}

/** 有没有画出条：一条都没有（空内容 / 太矮 / 行行都太短）→ 调用方退化成一块小色块 */
export function canRenderSkeletonBars(bars: SkeletonBar[]): boolean {
  return drawnBarCount(bars) > 0
}

/**
 * "下面还有内容"那一行的宽度：把整行收短示意"未完"，但**不低于 50%** ——
 * 收得比半行还短就跟前面那些短行看不出区别了，"还有下文"的提示也就丢了。
 */
function shortenForTruncation(lastPercent: number): number {
  const shortened = lastPercent * 0.62
  return Math.min(Math.max(shortened, MIN_BAR_WIDTH_PERCENT), lastPercent)
}

/**
 * 一条要画的条有多宽：先叠 20% 起伏，**最后**用 50% 下限兜底。
 *
 * 下限必须放在起伏之后：一条 26% 的短行叠上 0.86 会掉到 22%，先兜底再叠就还是掉回线下 ——
 * 用户要的是"不小于 50%"，那就得保证**画出来**的值不低于 50%。
 * 于是短行（10%~50% 之间）实际都落到 50% 那条线上，只有长行才看得到起伏。
 *
 * 两个边界的分工：下界管"别短得不像字"，上界 100 管"别越过内容盒"。
 */
function resolveDrawnWidth(percent: number, index: number): number {
  const scale = WIDTH_TEXTURE[index % WIDTH_TEXTURE.length]
  const textured = percent * scale
  return Math.min(Math.max(textured, MIN_BAR_WIDTH_PERCENT), 100)
}

/** 保留两位小数：写进 CSS 变量的数值不要带一串浮点尾巴（4.199999999999999px） */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

