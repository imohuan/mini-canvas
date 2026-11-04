/** 字体与圆角预设（与 shadcn-vue 的 create 配置项同名同顺序）。 */

export interface FontOption {
  id: string
  label: string
  /** Google Fonts 里的家族名（加载时用） */
  family: string
  fallback: string
  /**
   * Google Fonts 的字重轴。缺省按 400/500/600/700 取；
   * 只有单一字重的展示体（如 Ma Shan Zheng）必须传空串，否则 css2 接口会整条 400。
   */
  weights?: string
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'inter', label: 'Inter', family: 'Inter', fallback: 'sans-serif' },
  { id: 'geist-sans', label: 'Geist Sans', family: 'Geist', fallback: 'sans-serif' },
  { id: 'noto-sans', label: 'Noto Sans', family: 'Noto Sans', fallback: 'sans-serif' },
  { id: 'nunito-sans', label: 'Nunito Sans', family: 'Nunito Sans', fallback: 'sans-serif' },
  { id: 'figtree', label: 'Figtree', family: 'Figtree', fallback: 'sans-serif' },
  { id: 'roboto', label: 'Roboto', family: 'Roboto', fallback: 'sans-serif' },
  { id: 'raleway', label: 'Raleway', family: 'Raleway', fallback: 'sans-serif' },
  { id: 'dm-sans', label: 'DM Sans', family: 'DM Sans', fallback: 'sans-serif' },
  { id: 'public-sans', label: 'Public Sans', family: 'Public Sans', fallback: 'sans-serif' },
  { id: 'outfit', label: 'Outfit', family: 'Outfit', fallback: 'sans-serif' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono', fallback: 'monospace' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', fallback: 'serif' },
  { id: 'oxanium', label: 'Oxanium', family: 'Oxanium', fallback: 'sans-serif' },
  { id: 'manrope', label: 'Manrope', family: 'Manrope', fallback: 'sans-serif' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', fallback: 'sans-serif' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', fallback: 'sans-serif' },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', family: 'IBM Plex Sans', fallback: 'sans-serif' },
  { id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3', fallback: 'sans-serif' },
  { id: 'instrument-sans', label: 'Instrument Sans', family: 'Instrument Sans', fallback: 'sans-serif' },
  { id: 'geist-mono', label: 'Geist Mono', family: 'Geist Mono', fallback: 'monospace' },
  { id: 'noto-serif', label: 'Noto Serif', family: 'Noto Serif', fallback: 'serif' },
  { id: 'roboto-slab', label: 'Roboto Slab', family: 'Roboto Slab', fallback: 'serif' },
  { id: 'merriweather', label: 'Merriweather', family: 'Merriweather', fallback: 'serif' },
  { id: 'lora', label: 'Lora', family: 'Lora', fallback: 'serif' },
  /* —— 中文优先的字体：给「中文界面长什么样」提供真实样本 —— */
  { id: 'noto-sans-sc', label: 'Noto Sans SC（中文黑体）', family: 'Noto Sans SC', fallback: 'sans-serif' },
  { id: 'noto-serif-sc', label: 'Noto Serif SC（中文宋体）', family: 'Noto Serif SC', fallback: 'serif' },
  { id: 'zcool-xiaowei', label: 'ZCOOL XiaoWei（站酷小薇）', family: 'ZCOOL XiaoWei', fallback: 'serif', weights: '' },
  { id: 'ma-shan-zheng', label: 'Ma Shan Zheng（马善政楷书）', family: 'Ma Shan Zheng', fallback: 'cursive', weights: '' },
]

export function findFont(id: string): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0]!
}

/** 字体分组：菜单里按「中文 / 衬线 / 等宽 / 无衬线」分段，方便找。 */
export type FontGroup = 'cjk' | 'serif' | 'mono' | 'sans'

const CJK_FONT_IDS = new Set(['noto-sans-sc', 'noto-serif-sc', 'zcool-xiaowei', 'ma-shan-zheng'])

export function fontGroup(font: FontOption): FontGroup {
  if (CJK_FONT_IDS.has(font.id)) return 'cjk'
  if (font.fallback === 'monospace') return 'mono'
  if (font.fallback === 'serif' || font.fallback === 'cursive') return 'serif'
  return 'sans'
}

export interface RadiusOption {
  id: string
  label: string
  value: string
}

/**
 * 圆角档位。
 *
 * 用户口径 2026-11-04：原来的档位整体偏大（最小也有 0.45rem，最大 0.875rem），
 * 每一档看起来都很圆；而且用「默认」当标签分不清轻重。
 * 现在改成**无 / 极小 / 小 / 中 / 大**五档，步长 2px 起，默认档落在 6px。
 *
 * 「全圆（胶囊）」那一档已删除（用户 2026-11-04 二次反馈）：
 * 卡片、面板这类大块用它很怪，平时也没有必须设成全圆的场景。
 *
 * 关于 id：'default' 这一档保留（旧的存档里 themeRadius 可能写的是 default），
 * 但它现在表示「中 6px」，标签上不再出现“默认”两个字。
 */
export const RADIUS_OPTIONS: RadiusOption[] = [
  { id: 'none', label: '无（0px）', value: '0rem' },
  { id: 'xs', label: '极小（2px）', value: '0.125rem' },
  { id: 'small', label: '小（4px）', value: '0.25rem' },
  { id: 'default', label: '中（6px）', value: '0.375rem' },
  { id: 'large', label: '大（8px）', value: '0.5rem' },
]

/** 圆角档位 id → 档位（不认识的值回落到第一档）。 */
export function findRadius(id: string): RadiusOption {
  return RADIUS_OPTIONS.find((r) => r.id === id) ?? RADIUS_OPTIONS[0]!
}

/**
 * 动态加载 Google Fonts。
 *
 * 字体下拉里每一项都用自己的字体渲染，所以**预览里会一次加载全部**（每个字体一个 link，
 * 浏览器命中缓存后不重复下载）。真实应用只在选中时调用。
 */
export function loadFont(font: FontOption): void {
  if (!font.family || typeof document === 'undefined') return
  const id = `mc-font-${font.id}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  const family = encodeURIComponent(font.family).replace(/%20/g, '+')
  // weights 为 '' 表示该字体只有一个字重，不能带 :wght@ 轴，否则接口返回 400。
  const axis = font.weights === '' ? '' : `:wght@${font.weights ?? '400;500;600;700'}`
  link.href = `https://fonts.googleapis.com/css2?family=${family}${axis}&display=swap`
  document.head.appendChild(link)
}

/** 某个字体可用的 CSS font-family 栈（预览里给每一项自己套上）。 */
export function fontStack(font: FontOption): string {
  return `'${font.family}', ${font.fallback}`
}
