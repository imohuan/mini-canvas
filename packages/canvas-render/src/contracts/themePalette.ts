/**
 * themePalette —— **可配置主题色板**的唯一真源（纯逻辑，零 Vue；Node 可单测）。
 *
 * 解决的问题（用户原话）："两套主题，但你这边配置的只有一种颜色 —— 连接线我设成灰色，
 * 在暗色主题上就没法看了"。根因：`Config` 的 `color` 字段是**单值**，而亮/暗两套主题
 * 同一个语义位置本来就该有两个值。
 *
 * 做法：每个可配置颜色拆成**两格**（亮色 + 暗色），各自一个 Config 字段，各写一个内联变量：
 *
 * ```
 *   accentColorLight → --uic-accent-color-light → :root     { --ui-accent: var(--uic-accent-color-light, #0891b2) }
 *   accentColorDark  → --uic-accent-color-dark  → html.dark { --ui-accent: var(--uic-accent-color-dark,  #0891b2) }
 * ```
 *
 * 于是：消费方**照旧只写一次** `var(--ui-accent, 兜底)`，不知道有几套主题；
 * 切主题仍是纯 CSS 命中不同 branch，**零 JS、零重渲染**。
 *
 * 归属为什么是 canvas-render：与 `styles/ui-theme.css` 同理 —— 24 个插件里绝大多数都依赖
 * canvas-render，放这里它们自动拿到同一套色板；放 `@mini-canvas/ui` 则插件不在那棵依赖树上，
 * 只能各自硬编码（那正是改造前的状况）。
 *
 * 三件事各自单一真源，别抄第二遍：
 * ① 色板 token 表（本文件 THEME_COLOR_TOKENS）→ ② Config schema 与内联变量名（本文件派生）
 * → ③ CSS 侧消费（`styles/ui-theme.css` 的 `var(--uic-…, 默认值)`）。
 * ②③ 不漂移由 `__tests__/themePalette.test.ts` 钉住（漏一侧 = 切主题不变色，肉眼极难发现）。
 */
import type { ConfigSchema } from '@mini-canvas/kernel'

/** 主题模式：与 `<html class="dark">` 一一对应（Tailwind v4 / shadcn 通行做法） */
export type ThemeColorMode = 'light' | 'dark'

/**
 * 一个可配置颜色 token。
 * 约束：`light` / `dark` 必须是**不透明 hex** —— Config 的 `color` 字段只收 hex
 *（见 kernel/configSchema.ts 的 `case 'color'`）。半透明档一律用 color-mix 从主色现算，
 * 不要塞进色板（那样改主色时会"改一半"）。
 */
export interface ThemeColorToken {
  /** token 基名（camelCase），派生配置 key 用：accentColor → accentColorLight/accentColorDark */
  key: string
  /** 消费方写的 CSS 变量名（真源在 ui-theme.css，这里只登记名字，便于测试比对不漂移） */
  cssVar: string
  /** 设置面板里的中文名 */
  label: string
  /** 一句话说明这个颜色用在哪 */
  description: string
  /** 亮色主题下的默认值（hex） */
  light: string
  /** 暗色主题下的默认值（hex） */
  dark: string
}

/**
 * 色板内容。加新颜色 = 在这里加一行（+ 在 ui-theme.css 两侧各接一次）。
 *
 * 取舍：只收"跨主题语义稳定、且用户真的会想改"的颜色。
 * 背景/面板/文字这类**结构性**颜色留在 UI 规范里，不进色板 —— 它们成套联动，
 * 单拆一格出来改只会把主题改“脏”。
 */
export const THEME_COLOR_TOKENS: readonly ThemeColorToken[] = Object.freeze([
  {
    key: 'accentColor',
    cssVar: '--ui-accent',
    label: '强调色',
    description: '全界面唯一的品牌强调色：主按钮、选中态、滑块、开关、聚焦环、链接。',
    light: '#0891b2',
    dark: '#0891b2',
  },
  {
    key: 'accentHoverColor',
    cssVar: '--ui-accent-hover',
    label: '强调色（悬停）',
    description: '鼠标悬停/按下时强调色的加深版本，建议比强调色再深一档。',
    light: '#0e7490',
    dark: '#0e7490',
  },
  {
    key: 'dangerColor',
    cssVar: '--ui-danger',
    label: '危险色',
    description: '删除等破坏性操作的文字/图标色。',
    light: '#ef4444',
    dark: '#f87171',
  },
  {
    key: 'warnColor',
    cssVar: '--ui-warn',
    label: '警示色',
    description: '限时折扣、注意事项等提示文字色。',
    light: '#e3a25f',
    dark: '#e3a25f',
  },
  {
    key: 'edgeRailColor',
    cssVar: '--ui-edge-rail',
    label: '连线颜色',
    description: '连线的静态导轨色。暗色画布上请给浅色，否则线会"沉进"背景里看不见。',
    light: '#1f2937',
    dark: '#9ca3af',
  },
  {
    key: 'edgeFlowColor',
    cssVar: '--ui-edge-flow',
    label: '流光颜色',
    description: '连线被选中/拖线时沿路径流动的光斑色（缺省取强调色）。',
    light: '#0891b2',
    dark: '#22d3ee',
  },
  {
    key: 'guideColor',
    cssVar: '--ui-guide',
    label: '参考线颜色',
    description: '拖拽时的对齐辅助线与框选框颜色。',
    light: '#3b82f6',
    dark: '#6366f1',
  },
])

/** 亮色主题的配置分组（一级「常规」，与其它设置同层；二级点明是哪个主题） */
export const THEME_COLOR_LIGHT_GROUP = '常规/主题配色'
/** 暗色主题的配置分组 */
export const THEME_COLOR_DARK_GROUP = '常规/暗色主题配色'

/** 展平后的一格：一个 token × 一个主题模式 = 一个 Config 字段 = 一个内联变量 */
export interface ThemeColorSlot {
  /** 所属 token */
  token: ThemeColorToken
  /** 这一格属于哪个主题 */
  mode: ThemeColorMode
  /** settings 里的 key（Config 字段名） */
  settingKey: string
  /** 这一格写入的内联 CSS 变量名 */
  cssVar: string
  /** 默认值（hex） */
  default: string
  /** 设置面板分组 */
  group: string
}

/** camelCase → kebab-case（accentHoverColor → accent-hover-color） */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** 亮色那格的 settings key：accentColor → accentColorLight */
export function themeColorLightKey(key: string): string {
  return `${key}Light`
}

/** 暗色那格的 settings key：accentColor → accentColorDark */
export function themeColorDarkKey(key: string): string {
  return `${key}Dark`
}

/**
 * 某一格写入的内联变量名：`--uic-<token-kebab>-<light|dark>`。
 *
 * 为什么两格用**两个不同名字**的变量、而不是同名变量按主题各写一次：内联样式写在
 * `<html>` 一个元素上，没有"按主题分支"的余地 —— 同名会被后写的覆盖掉。
 * 拆成两个名字，由 ui-theme.css 的 `:root` / `html.dark` 各自挑一个，才是纯 CSS 切换。
 */
export function themeColorInlineVar(key: string, mode: ThemeColorMode): string {
  return `--uic-${kebab(key)}-${mode}`
}

/** 色板展平成 2×N 格（唯一派生入口；Config / 变量 / 归类都从它来，避免三处各算一遍） */
export function themeColorSlots(): ThemeColorSlot[] {
  const out: ThemeColorSlot[] = []
  for (const token of THEME_COLOR_TOKENS) {
    for (const mode of ['light', 'dark'] as const) {
      out.push({
        token,
        mode,
        settingKey: mode === 'light' ? themeColorLightKey(token.key) : themeColorDarkKey(token.key),
        cssVar: themeColorInlineVar(token.key, mode),
        default: mode === 'light' ? token.light : token.dark,
        group: mode === 'light' ? THEME_COLOR_LIGHT_GROUP : THEME_COLOR_DARK_GROUP,
      })
    }
  }
  return out
}

/**
 * 生成本色板的 Config schema（内核装配时登记进 settings 单一数据源 → 设置面板自动长出取色器）。
 * 亮色格与暗色格分别落两个分组，设置面板里就是两个页签，不会糊成一坨。
 */
export function buildThemeColorConfig(): ConfigSchema {
  const schema: ConfigSchema = {}
  for (const slot of themeColorSlots()) {
    schema[slot.settingKey] = {
      type: 'color',
      default: slot.default,
      label: slot.token.label,
      group: slot.group,
      description:
        slot.mode === 'light'
          ? `亮色主题下的${slot.token.label}。${slot.token.description}`
          : `暗色主题下的${slot.token.label}。${slot.token.description}`,
    }
  }
  return schema
}

/** 色板全部内联变量名（插件卸载时逐个清掉，防"幽灵变量"挡住下一个主题） */
export function themeColorVarNames(): string[] {
  return themeColorSlots().map((s) => s.cssVar)
}

/** 是否属于本色板的 key（订阅回调里只认自己的 key，别人的变化不误触） */
export function isThemeColorKey(key: string): boolean {
  return themeColorSlots().some((s) => s.settingKey === key)
}

/** 一格内联变量的赋值 */
export interface ThemeColorVar {
  name: string
  value: string
}

/**
 * 从取值器解析出**用户改过的那几格**（纯函数）—— 只返回与 token 默认值不同的项。
 *
 * 为什么"等于默认值就不写"：内联变量优先级最高，会把主题插件在 CSS 里给的配色一起压掉。
 * 用户没动过的格子保持"不写"，CSS 侧的 `var(--uic-…, 默认)` 与主题插件才拿得到控制权；
 * 一旦用户真的改了，那一格才以最高优先级钉住。
 *
 * 空值/非字符串一律跳过（跳过 = 回落 CSS 默认值，比写空串安全）。
 */
export function resolveThemeColorOverrides(get: (key: string) => unknown): ThemeColorVar[] {
  const out: ThemeColorVar[] = []
  for (const slot of themeColorSlots()) {
    const raw = get(slot.settingKey)
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (!value) continue
    if (value.toLowerCase() === slot.default.toLowerCase()) continue
    out.push({ name: slot.cssVar, value })
  }
  return out
}

/**
 * 取某个 token 在指定主题下的当前值（给**非 CSS 通道**的消费方用：比如连线外观要的是一个
 * 字符串塞进 `edgeVisual`，那边吃不到 CSS 变量）。
 */
export function resolveThemeColorValue(
  get: (key: string) => unknown,
  key: string,
  mode: ThemeColorMode,
): string | undefined {
  const slot = themeColorSlots().find((s) => s.token.key === key && s.mode === mode)
  if (!slot) return undefined
  const raw = get(slot.settingKey)
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return slot.default
}

/** 取当前主题模式（`<html class="dark">` 为准；无 DOM 环境一律 light） */
export function currentThemeMode(root?: Element | null): ThemeColorMode {
  const el = root ?? (typeof document === 'undefined' ? null : document.documentElement)
  return el && el.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * 订阅主题模式变化（**全仓唯一一处** `<html>` 监听，多个订阅者共用同一个观察器）。
 *
 * 为什么收在这里、不让各插件各自 MutationObserver：主题是全局的，若每个插件都挂一个观察器
 * 盯着 `<html>`，既重复又容易在"插件 A 已响应、插件 B 还没"的中间态下闪一下。
 *
 * 为什么必须**共用单例**（而不是每次调用建一个）：消费方是**每个边组件一份**
 * （见 useThemeColor）—— 一张画布几百条连线就是几百个 MutationObserver 盯着同一个元素，
 * 代价与元素数量成正比。这里用一个模块级观察器 + 订阅者集合，观察器只在"首个订阅者到来"时挂、
 * "最后一个订阅者离开"时卸。
 *
 * @returns 取消订阅函数；无 DOM 环境返回 no-op
 */
export function watchThemeMode(cb: (mode: ThemeColorMode) => void, root?: Element | null): () => void {
  const el = root ?? (typeof document === 'undefined' ? null : document.documentElement)
  if (!el || typeof MutationObserver === 'undefined') return () => {}

  const entry = sharedThemeWatch(el)
  entry.subscribers.add(cb)
  entry.ensure()
  return () => {
    entry.subscribers.delete(cb)
    entry.releaseIfIdle()
  }
}

/** 色板运行期依赖的最小 settings 接口（内核 SettingsStore 满足） */
export interface ThemePaletteSettingsLike {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

/** 一个观察目标上的共享监听账目（每个元素一份，多个订阅者共用同一个 MutationObserver） */
interface SharedThemeWatch {
  subscribers: Set<(mode: ThemeColorMode) => void>
  /** 惰性挂观察器（首个订阅者到来时） */
  ensure(): void
  /** 订阅者清空时卸掉观察器并回收账目（不留空转的 observer） */
  releaseIfIdle(): void
}

/**
 * 共享监听账目表：key = 观察元素（WeakMap 让元素被回收时账目跟着消失）。
 * 只用一个元素（`<html>`）是常态；按元素分账是为了让测试能传自己的假元素而不互相干扰。
 */
const themeWatchEntries = new WeakMap<Element, SharedThemeWatch>()

function sharedThemeWatch(el: Element): SharedThemeWatch {
  const existing = themeWatchEntries.get(el)
  if (existing) return existing

  const subscribers = new Set<(mode: ThemeColorMode) => void>()
  let observer: MutationObserver | undefined

  const entry: SharedThemeWatch = {
    subscribers,
    ensure(): void {
      if (observer) return
      observer = new MutationObserver(() => {
        const mode = currentThemeMode(el)
        // 复制一份再遍历：订阅者回调里可能退订（改了集合会让遍历漏掉后面的订阅者）
        for (const cb of [...subscribers]) {
          try {
            cb(mode)
          } catch {
            /* 单个订阅者异常不阻断其它订阅者 */
          }
        }
      })
      observer.observe(el, { attributes: true, attributeFilter: ['class', 'data-canvas-theme'] })
    },
    releaseIfIdle(): void {
      if (subscribers.size > 0) return
      observer?.disconnect()
      observer = undefined
      themeWatchEntries.delete(el)
    },
  }

  themeWatchEntries.set(el, entry)
  return entry
}

/** 色板插件的模块名（装配清单与诊断里按它找） */
export const THEME_PALETTE_PLUGIN_NAME = 'canvas-theme-palette'
