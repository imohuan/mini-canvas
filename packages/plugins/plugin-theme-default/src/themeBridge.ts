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
 *   由组件库的 host.css 消费（`--radius-sm/md/lg/xl`、全站 `font-family`）。
 *
 * 为什么是 `--mct-*` 而不是直接改 `--radius`：`--radius` 是 shadcn 自己的变量名，
 * 组件库里只有个别文件用；直接占用它会让「以后组件库升级」与「主题包」抢同一个名字。
 * 用带前缀的变量，谁消费谁声明，边界清楚。
 *
 * **选项表（字体 / 圆角）不在本文件重复**：直接引用组件库导出的 `FONT_OPTIONS` /
 * `RADIUS_OPTIONS`，否则预览页加一种字体、真实应用不跟着加，两份必然漂移。
 */
import {
  FONT_OPTIONS,
  RADIUS_OPTIONS,
  SIZE_OPTIONS,
  findFont,
  loadFont,
  sizeCssVars,
  type FontOption,
  type RadiusOption,
} from '@mini-canvas/ui-kit-shadcn'

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
 * 尺寸档位：`inherit` = 不写变量，各组件的 size prop 各管各的（升级前的行为）；
 * 其余四档写 `--mct-size-*`，组件库按 data-slot 统一尺寸。
 */
export const THEME_SIZE_CHOICES = ['inherit', ...SIZE_OPTIONS.map((s) => s.id)] as const
export type ThemeSizeChoice = (typeof THEME_SIZE_CHOICES)[number]

/** 档位 id → 设置面板文字 */
export const THEME_SIZE_LABELS: Readonly<Record<string, string>> = {
  inherit: '跟随组件默认',
  ...Object.fromEntries(SIZE_OPTIONS.map((s) => [s.id, s.label])),
}

/** 档位 id → 一句话说明（设置面板副标题用） */
export const THEME_SIZE_HINTS: Readonly<Record<string, string>> = {
  inherit: '各组件按自己的 size prop 显示，不做统一缩放',
  ...Object.fromEntries(SIZE_OPTIONS.map((s) => [s.id, s.hint])),
}

/**
 * 尺寸变量名清单（所有档位的键相同，取标准档即可）。
 * 清理旧值时也要按这份清单 removeProperty，否则切换档位会留下幽灵变量。
 */
export const THEME_SIZE_VARS: readonly string[] = Object.keys(SIZE_OPTIONS[1]!.vars)

/**
 * 字体 id → CSS font-family 栈。
 *
 * 只列「本地 / 系统已装就有效」的常见家族。选中的字体由 `applyThemeBridge` 调
 * 组件库的 `loadFont` 按需插一次 Google Fonts `<link>`（与预览页同一条路），
 * 机器上没装该字体时也能真的换过去。
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
  /**
   * 项目自带的三档圆角 token（ui-theme.css）。设置面板里的字段控件
   * （SettingsSchemaField / 导航项）直接读它们，且带 scoped 的 data-v 属性，
   * 优先级高于组件库的 [data-slot]；不一起写的话，用户选了大圆角，
   * 设置面板里的下拉/输入框仍是 8px（2026-11-02 真机验证）。
   */
  radiusControl: '--radius-control',
  radiusOpen: '--radius-open',
  radiusPanel: '--radius-panel',
} as const

export interface ThemeBridgeInput {
  /** 圆角档位；inherit 表示跟随项目原有 `--radius-control` */
  radius: ThemeRadiusChoice
  /** 正文字体；inherit 表示跟随宿主 */
  font: ThemeFontChoice
  /** 标题字体；inherit 表示跟随正文 */
  heading: ThemeFontChoice | 'inherit'
  /** 控件尺寸档位；inherit 表示不统一（各组件按自己的 size prop） */
  size: ThemeSizeChoice
}

/** 把设置里读到的裸字符串收敛成合法档位；不认识的值一律回落到默认档 */
export function toThemeBridgeInput(raw: {
  themeRadius?: unknown
  themeFont?: unknown
  themeHeadingFont?: unknown
  themeSize?: unknown
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
  const size = THEME_SIZE_CHOICES.includes(raw.themeSize as ThemeSizeChoice)
    ? (raw.themeSize as ThemeSizeChoice)
    : 'inherit'
  return { radius, font, heading, size }
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
  if (input.radius !== 'inherit') {
    const value = THEME_RADIUS_VALUES[input.radius] ?? ''
    out[THEME_BRIDGE_VARS.radius] = value
    // 项目自身的控件 / 浮层 / 面板三档一起跟随：只改组件库会让设置面板里外两套圆角
    out[THEME_BRIDGE_VARS.radiusControl] = value
    out[THEME_BRIDGE_VARS.radiusOpen] = 'calc(' + value + ' * 1.5)'
    out[THEME_BRIDGE_VARS.radiusPanel] = 'calc(' + value + ' * 2)'
  }
  const body = THEME_FONT_STACKS[input.font] ?? ''
  if (body) out[THEME_BRIDGE_VARS.fontBody] = body
  // 标题：inherit = 跟随正文（写 var 引用，正文变了标题一起变）
  if (input.heading === 'inherit') {
    if (body) out[THEME_BRIDGE_VARS.fontHeading] = 'var(--mct-font-body, inherit)'
  } else {
    const heading = THEME_FONT_STACKS[input.heading] ?? ''
    if (heading) out[THEME_BRIDGE_VARS.fontHeading] = heading
  }
  // 尺寸：一档写一整组变量；inherit 不写，组件库回落到 shadcn 原始尺寸
  if (input.size !== 'inherit') Object.assign(out, sizeCssVars(input.size))
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
  for (const name of [...Object.values(THEME_BRIDGE_VARS), ...THEME_SIZE_VARS]) {
    const value = next[name]
    if (value) el.style.setProperty(name, value)
    else el.style.removeProperty(name)
  }
  /**
   * 尺寸是「可选档位」：只有真选了才写 data-mct-size。
   * size.css 的选择器都以这个属性为前提，否则默认档也会把调用点自己的
   * h-8 / size-6 压掉（本文件不加 important，但无层样式会赢过 utilities）。
   */
  if (input.size === 'inherit') el.removeAttribute('data-mct-size')
  else el.setAttribute('data-mct-size', input.size)
  // 预览页选了字体后会按需插 Google Fonts；真实应用也走同一条路，
  // 否则用户选了 Inter 之类的字体，机器上没装就还是原来的字。
  // loadFont 内部有 typeof document 守卫，纯函数单测不会碰网络。
  if (input.font !== 'inherit') loadFont(findFont(input.font))
  if (input.heading !== 'inherit' && input.heading !== input.font) {
    loadFont(findFont(input.heading))
  }
}

/** 清空桥接变量（主题卸载 / 停用时调用，避免幽灵变量挡住下一个主题） */
export function clearThemeBridge(root?: HTMLElement): void {
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (!el) return
  for (const name of [...Object.values(THEME_BRIDGE_VARS), ...THEME_SIZE_VARS]) {
    el.style.removeProperty(name)
  }
  el.removeAttribute('data-mct-size')
}
