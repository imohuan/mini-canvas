/**
 * themeBridge —— 把主题的「外观配置」交接给组件库（`@mini-canvas/ui-kit-shadcn`）。
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
 * 住在 @mini-canvas/theme-contract 的原因：两个主题包都要读同一套变量与档位表，
 * 放在任何一边都会让另一边反向 import 插件。这里只有纯 TS，零 .vue。
 *
 * **选项表（字体 / 圆角）不在本文件重复**：直接引用组件库导出的 `FONT_OPTIONS` /
 * `RADIUS_OPTIONS`，否则预览页加一种字体、真实应用不跟着加，两份必然漂移。
 */
import {
  FONT_OPTIONS,
  RADIUS_OPTIONS,
  findFont,
  loadFont,
  type FontOption,
  type RadiusOption,
} from '@mini-canvas/ui-kit-shadcn/theme/fonts'
// 尺寸配置来自组件库的**纯 TS 模块**，不走包根：
// 包根会连带 .vue 组件，纯 node 单测（theme-contract）解析不了。
import {
  COMPONENT_SIZE_CHOICES,
  resetComponentConfig,
  setComponentConfig,
  type ComponentSize,
} from '@mini-canvas/ui-kit-shadcn/componentConfig'


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
 * 尺寸档位：`inherit` = 各组件的 size prop 各管各的；
 * 其余档写进组件配置，由注册薄层注入给**声明了 size prop** 的组件。
 * 不声明 size 的组件（输入框 / 卡片等）不受影响 —— 这是有意的：
 * 它们本来就没有尺寸档位可“选”，从外面用 CSS 压会绕开组件自己的尺寸体系。
 */
export const THEME_SIZE_CHOICES = ['inherit', ...COMPONENT_SIZE_CHOICES] as const
export type ThemeSizeChoice = (typeof THEME_SIZE_CHOICES)[number]

/** 档位 id → 设置面板文字 */
export const THEME_SIZE_LABELS: Readonly<Record<string, string>> = {
  inherit: '跟随组件默认',
  sm: '小',
  default: '标准',
  lg: '大',
}

/** 档位 id → 一句话说明（设置面板副标题用） */
export const THEME_SIZE_HINTS: Readonly<Record<string, string>> = {
  inherit: '各组件按自己的 size prop 显示，不做统一缩放',
  sm: '带 size 的组件默认用小档',
  default: '带 size 的组件默认用标准档',
  lg: '带 size 的组件默认用大档',
}

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
  // —— 中文优先的字体（与组件库 FONT_OPTIONS 一一对应，漏一个就会「选了点不动」）——
  'noto-sans-sc': "'Noto Sans SC', 'Noto Sans', system-ui, sans-serif",
  'noto-serif-sc': "'Noto Serif SC', 'Noto Serif', Georgia, serif",
  'zcool-xiaowei': "'ZCOOL XiaoWei', 'Noto Serif SC', serif",
  'ma-shan-zheng': "'Ma Shan Zheng', 'ZCOOL XiaoWei', cursive",
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
  /**
   * 设置面板的行高 / 控件高度（导航项、设置行）。
   *
   * 组件库的控件高度由 `size` prop 决定，但设置面板里的导航按钮、行容器是
   * 主题自己的 CSS，没有 size prop；以前它们读一个**从没有人写**的
   * `--mct-size-control-h`，所以改「控件尺寸」时面板里的行完全不动
   * （用户 2026-11-05 实测：切到「大」后设置界面毫无变化）。
   * 这里按同一档位把行高落成变量，面板里的行与组件库控件才会一起变。
   */
  sizeControlHeight: '--mct-size-control-h',
} as const

/** 尺寸档位 → 设置面板行高（与 Button 的 h-8 / h-9 / h-10 对齐） */
const ROW_HEIGHT: Readonly<Record<string, string>> = {
  sm: '2rem',
  default: '2.25rem',
  lg: '2.5rem',
}

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
  // 设置面板自己的行高跟尺寸档走；inherit 表示不写，回落到项目原有 36px。
  if (input.size !== 'inherit') {
    const rowHeight = ROW_HEIGHT[input.size] ?? ''
    if (rowHeight) out[THEME_BRIDGE_VARS.sizeControlHeight] = rowHeight
  }
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
  // 尺寸走组件配置（行为类），不写 CSS：由注册薄层注入给声明了 size 的组件。
  // inherit = 不注入默认值，各组件的 size prop 各管各的。
  setComponentConfig({ size: input.size === 'inherit' ? 'default' : input.size })
  const next = resolveThemeBridgeVars(input)
  for (const name of Object.values(THEME_BRIDGE_VARS)) {
    const value = next[name]
    if (value) el.style.setProperty(name, value)
    else el.style.removeProperty(name)
  }
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
  for (const name of Object.values(THEME_BRIDGE_VARS)) {
    el.style.removeProperty(name)
  }
  resetComponentConfig()
}
