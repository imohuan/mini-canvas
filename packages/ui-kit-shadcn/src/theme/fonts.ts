/** 字体与圆角预设（与 shadcn-vue 的 create 配置项同名同顺序）。 */

export interface FontOption {
  id: string
  label: string
  /** Google Fonts 里的家族名（加载时用） */
  family: string
  /** CSS 变量：--font-sans / --font-serif / --font-mono */
  variable: string
  fallback: string
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'inter', label: 'Inter', family: 'Inter', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'geist-sans', label: 'Geist Sans', family: 'Geist', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'noto-sans', label: 'Noto Sans', family: 'Noto Sans', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'nunito-sans', label: 'Nunito Sans', family: 'Nunito Sans', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'figtree', label: 'Figtree', family: 'Figtree', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'roboto', label: 'Roboto', family: 'Roboto', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'raleway', label: 'Raleway', family: 'Raleway', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'dm-sans', label: 'DM Sans', family: 'DM Sans', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'public-sans', label: 'Public Sans', family: 'Public Sans', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'outfit', label: 'Outfit', family: 'Outfit', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: 'JetBrains Mono', variable: '--font-mono', fallback: 'monospace' },
  { id: 'playfair-display', label: 'Playfair Display', family: 'Playfair Display', variable: '--font-serif', fallback: 'serif' },
  { id: 'oxanium', label: 'Oxanium', family: 'Oxanium', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'manrope', label: 'Manrope', family: 'Manrope', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'space-grotesk', label: 'Space Grotesk', family: 'Space Grotesk', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'montserrat', label: 'Montserrat', family: 'Montserrat', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'ibm-plex-sans', label: 'IBM Plex Sans', family: 'IBM Plex Sans', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'source-sans-3', label: 'Source Sans 3', family: 'Source Sans 3', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'instrument-sans', label: 'Instrument Sans', family: 'Instrument Sans', variable: '--font-sans', fallback: 'sans-serif' },
  { id: 'geist-mono', label: 'Geist Mono', family: 'Geist Mono', variable: '--font-mono', fallback: 'monospace' },
  { id: 'noto-serif', label: 'Noto Serif', family: 'Noto Serif', variable: '--font-serif', fallback: 'serif' },
  { id: 'roboto-slab', label: 'Roboto Slab', family: 'Roboto Slab', variable: '--font-serif', fallback: 'serif' },
  { id: 'merriweather', label: 'Merriweather', family: 'Merriweather', variable: '--font-serif', fallback: 'serif' },
  { id: 'lora', label: 'Lora', family: 'Lora', variable: '--font-serif', fallback: 'serif' },
]

export function findFont(id: string): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[15]!
}

/** 标题字体多一个「跟随正文」选项。 */
export const HEADING_OPTIONS = [{ id: 'inherit', label: '跟随正文', family: '', variable: '', fallback: '' }, ...FONT_OPTIONS]

export interface RadiusOption {
  id: string
  label: string
  value: string
}

export const RADIUS_OPTIONS: RadiusOption[] = [
  { id: 'default', label: '默认（0.625rem）', value: '0.625rem' },
  { id: 'none', label: '无圆角', value: '0rem' },
  { id: 'small', label: '小（0.45rem）', value: '0.45rem' },
  { id: 'medium', label: '中（0.625rem）', value: '0.625rem' },
  { id: 'large', label: '大（0.875rem）', value: '0.875rem' },
]

/** 动态加载 Google Fonts（只加载当前选中的正文字体与标题字体）。 */
export function loadFont(font: FontOption): void {
  if (!font.family || typeof document === 'undefined') return
  const id = `mc-font-${font.id}`
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.family).replace(/%20/g, '+')}:wght@400;500;600;700&display=swap`
  document.head.appendChild(link)
}
