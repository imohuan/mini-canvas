/**
 * themeBridge —— 把默认主题的「外观配置」交接给组件库（`@mini-canvas/ui-kit-shadcn`）。
 *
 * 要解决的问题（用户口径）：组件库预览页 `src/App.vue` 里已经有一套可选的外观
 * （base color / theme / chart color / font / heading / radius），但真实应用里没人读它，
 * 那套配置等于只活在预览页。
 *
 * 分工（两边都不抢对方的真源）：
 * - **颜色**：项目一直用 `--ui-*` 语义色（`canvas-render` 的 themePalette 负责亮/暗两格，
 *   用户还可在设置里逐个改）。组件库的 `styles/host.css` 已经把这些语义色映射成
 *   shadcn 的 `--primary` / `--background` / …，所以**颜色本来就已经接上了**，
 *   这里不再写第二份色板 —— 否则用户改「强调色」时组件库不跟着变，正是要避免的漂移。
 * - **形状 / 字体**：这两项项目里原本没有统一出口，这里补上。写成 `--mct-*` 变量，
 *   由组件库的 host.css 消费（`--radius-sm/md/lg/xl`、`font-family`）。
 *
 * 为什么是 `--mct-*` 而不是直接改 `--radius`：`--radius` 是 shadcn 自己的变量名，
 * 组件库里只有个别文件用；直接占用它会让「以后组件库升级」与「主题包」抢同一个名字。
 * 用带前缀的变量，谁消费谁声明，边界清楚。
 *
 * **选项表（字体 / 圆角）不在本文件重复**：直接引用组件库导出的 `FONT_OPTIONS` /
 * `RADIUS_OPTIONS`，否则预览页加一种字体、真实应用不跟着加，两份必然漂移。
 */
import { FONT_OPTIONS, RADIUS_OPTIONS, type FontOption, type RadiusOption } from '@mini-canvas/ui-kit-shadcn'

/** 字体选项：`inherit`（跟随宿主）在最前，其余原样取自组件库 */
export const THEME_FONT_OPTIONS: readonly FontOption[] = FONT_OPTIONS

/** 圆角选项：原样取自组件库 */
export const THEME_RADIUS_OPTIONS: readonly RadiusOption[] = RADIUS_OPTIONS

/** 组件库可选字体 id（新增 `inherit`） */
export const THEME_FONT_CHOICES = [
  'inherit',
  ...FONT_OPTIONS.map((f) => f.id),
] as const

export type ThemeFontChoice = (typeof THEME_FONT_CHOICES)[number]

/** 字体 id → 设置面板里显示的短名字（取自组件库，`inherit` 是本层新增的「跟随宿主」） */
export const THEME_FONT_LABELS: Readonly<Record<string, string>> = {
  inherit: '跟随宿主',
  ...Object.fromEntries(FONT_OPTIONS.map((f) => [f.id, f.label])),
}

/** 圆角档位：`inherit` 是主题包新增的「跟随项目」，其余取自组件库 */
export const THEME_RADIUS_CHOICES = ['inherit', ...RADIUS_OPTIONS.map((r) => r.id)] as const
export type ThemeRadiusChoice = (typeof THEME_RADIUS_CHOICES)[number]

/** 圆角档位 → 实际像素值（取自组件库；`inherit` 不写值 = 跟随项目 token） */
export const THEME_RADIUS_VALUES: Readonly<Record<string, string>> = Object.fromEntries(
  RADIUS_OPTIONS.map((r) => [r.id, r.value]),
)

/** 圆角档位 → 设置面板文字 */
export const THEME_RADIUS_LABELS: Readonly<Record<string, string>> = {
  inherit: '跟随项目（8px）',
  ...Object.fromEntries(RADIUS_OPTIONS.map((r) => [r.id, r.label])),
}

/**
 * 字体 id → CSS font-family 栈。
 *
 * 只列「本地 / 系统已装就有效」的常见家族：真要用 Web Font，应由使用方在自己的
 * 入口按需加载（组件库预览页就是动态插 `<link>`）。主题包不偷偷往用户页面塞外链。
 */
export const THEME_FONT_STACKS: Readonly<Record<ThemeFontChoice, string>> = {
  inherit: '',
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  'geist-sans': "'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif",
  'noto-sans': "'Noto Sans', 'Noto Sans SC', system-ui, sans-serif",
  'nunito-sans': "'Nunito Sans', system-ui, sans-serif",
  figtree: "'Figtree', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  raleway: "'Raleway', system-ui, sans-serif",
  'dm-sans': "'DM Sans', system-ui, sans-serif",
  'public-sans': "'Public Sans', system-ui, sans-serif",
  outfit: "'Outfit', system-ui, sans-serif",
  manrope: "'Manrope', system-ui, sans-serif",
  'space-grotesk': "'Space Grotesk', system-ui, sans-serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
  'ibm-plex-sans': "'IBM Plex Sans', system-ui, sans-serif",
  'source-sans-3': "'Source Sans 3', system-ui, sans-serif",
  'instrument-sans': "'Instrument Sans', system-ui, sans-serif",
  // 等宽 / 衬线：组件库 FONT_OPTIONS 里也有这几项，漏了会造成「选了点不动」
  'jetbrains-mono': "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  'geist-mono': "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  'playfair-display': "'Playfair Display', Georgia, serif",
  'noto-serif': "'Noto Serif', 'Noto Serif SC', Georgia, serif",
  'roboto-slab': "'Roboto Slab', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  oxanium: "'Oxanium', system-ui, sans-serif",
}

/** 桥接要写进 `<html>` 的变量名（只在有自定义值时写，缺省一律清掉） */
export const THEME_BRIDGE_VARS = {
  radius: '--mct-radius',
  fontBody: '--mct-font-body',
  fontHeading: '--mct-font-heading',
} as const

export interface ThemeBridgeInput {
  /** 圆角档位；inherit 表示跟随项目原有 `--radius-control` */
  radius: ThemeRadiusChoice
  /** 正文字体；inherit 表示跟随宿主 */
  font: ThemeFontChoice
  /** 标题字体；inherit 表示跟随正文 */
  heading: ThemeFontChoice | 'inherit'
}

/** 把设置里读到的裸字符串收敛成合法档位；不认识的值一律回落到默认档 */
export function toThemeBridgeInput(raw: {
  themeRadius?: unknown
  themeFont?: unknown
  themeHeadingFont?: unknown
}): ThemeBridgeInput {
  const radius = THEME_RADIUS_CHOICES.includes(raw.themeRadius as ThemeRadiusChoice)
    ? (raw.themeRadius as ThemeRadiusChoice)
    : 'inherit'
  const font = THEME_FONT_CHOICES.includes(raw.themeFont as ThemeFontChoice)
    ? (raw.themeFont as ThemeFontChoice)
    : 'inherit'
  const heading = THEME_FONT_CHOICES.includes(raw.themeHeadingFont as ThemeFontChoice)
    ? (raw.themeHeadingFont as ThemeFontChoice)
    : 'inherit'
  return { radius, font, heading }
}

/**
 * 把配置解析成「要写哪些变量」。
 *
 * 返回空字符串表示「不要写」，调用方据此 removeProperty —— 这与 themePalette 的
 * `resolveThemeColorOverrides` 同一套思路：用户没动过的项不落内联，把控制权留在 CSS。
 */
export function resolveThemeBridgeVars(input: ThemeBridgeInput): Record<string, string> {
  const out: Record<string, string> = {}
  // 默认档不写：组件库回落到 --radius-control（项目原有 8px），保持历史观感
  if (input.radius !== 'inherit') out[THEME_BRIDGE_VARS.radius] = THEME_RADIUS_VALUES[input.radius] ?? ''
  const body = THEME_FONT_STACKS[input.font] ?? ''
  if (body) out[THEME_BRIDGE_VARS.fontBody] = body
  // 标题：inherit = 跟随正文（写 var 引用，正文变了标题一起变）
  if (input.heading === 'inherit') {
    if (body) out[THEME_BRIDGE_VARS.fontHeading] = 'var(--mct-font-body, inherit)'
  } else {
    const heading = THEME_FONT_STACKS[input.heading] ?? ''
    if (heading) out[THEME_BRIDGE_VARS.fontHeading] = heading
  }
  return out
}

/**
 * 落值：按当前配置写内联变量，并清掉上一轮写过、这一轮不该有的键。
 *
 * 纯 DOM 操作、幂等，可反复调用（设置面板每次改都会调用一次）。
 */
export function applyThemeBridge(input: ThemeBridgeInput, root?: HTMLElement): void {
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (!el) return
  const next = resolveThemeBridgeVars(input)
  for (const name of Object.values(THEME_BRIDGE_VARS)) {
    const value = next[name]
    if (value) el.style.setProperty(name, value)
    else el.style.removeProperty(name)
  }
}

/** 清空桥接变量（主题卸载 / 停用时调用，避免幽灵变量挡住下一个主题） */
export function clearThemeBridge(root?: HTMLElement): void {
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (!el) return
  for (const name of Object.values(THEME_BRIDGE_VARS)) el.style.removeProperty(name)
}
