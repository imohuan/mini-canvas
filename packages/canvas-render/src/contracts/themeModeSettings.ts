/**
 * themeModeSettings —— 「主题模式」（亮色 / 暗色）作为**渲染层配置**的声明、读取与落值。
 *
 * 解决什么：此前亮/暗只由成品应用的一个散状态（ui.ts 的 state.theme）控制，默认值写死 'dark'，
 * 既不进 settings 单一数据源、也无法持久化 —— 用户点了右上角调色板切到亮色，刷新又回到暗色。
 * 本模块把「当前是亮色还是暗色」收进渲染层配置（与 canvasInteractionSettings 同一套语义），
 * 于是：设置面板能给一项、settingsPersist 能持久化、任一宿主都自带。
 *
 * 为什么归属 canvas-render：与色板（themePalette）同理 —— 主题模式决定 ui-theme.css 里
 * :root / html.dark 哪一套生效，是渲染层的事；放这里 24 个依赖 canvas-render 的插件自动一致。
 *
 * 与「不要给单个插件发明 theme 配置项」的区别（docs/代码开发/主题与配色.md §3.3）：
 * 那是禁止**按插件**各切各的主题；这里是**全应用唯一**的一个主题开关，全局一起换，
 * 不存在「两个组件同一时刻显示不同主题」，正是规范里说明的允许情形。
 */
import type { SettingSchema } from '@mini-canvas/kernel'

/** 设置 key（settings 全局平面命名，先声明者独占） */
export const THEME_MODE_KEY = 'themeMode'

/** 设置面板里的分组：一级「常规」/ 二级「外观」（与「常规/画布」同层） */
export const THEME_MODE_GROUP = '常规/外观'

/** 主题模式：与 `<html class="dark">` 一一对应 */
export type ThemeMode = 'light' | 'dark'

/** 默认暗色（对齐 index.html 首屏 class="dark"，避免首屏亮→暗闪一下） */
export const THEME_MODE_DEFAULT: ThemeMode = 'dark'

/**
 * 供 SettingsStore.define 的一项声明。
 * 注意 SettingSchema 本身不带 group（分组是由 define(group, …) 的实参决定的），
 * 所以这里不带 group 字段；分组名见 THEME_MODE_GROUP。
 */
export const THEME_MODE_SCHEMA: Record<string, SettingSchema> = {
  [THEME_MODE_KEY]: {
    type: 'select',
    default: THEME_MODE_DEFAULT,
    label: '主题模式',
    description: '整界面亮色 / 暗色。切换后立即生效，并随其他设置一起记住（刷新不回退）。',
    options: [
      { value: 'dark', label: '暗色' },
      { value: 'light', label: '亮色' },
    ],
  },
}

/** 把任意取值收敛成合法主题模式（非法 / 缺省 → 回落默认） */
export function resolveThemeMode(get: (key: string) => unknown): ThemeMode {
  const raw = get(THEME_MODE_KEY)
  return raw === 'light' || raw === 'dark' ? raw : THEME_MODE_DEFAULT
}

/**
 * 把主题模式落到 DOM：增删 `<html>` 的 `dark` class（Tailwind v4 / shadcn 通行做法），
 * 并同步保留 `data-canvas-theme` 属性（兼容仍按属性写的旧样式 / 外部宿主）。
 *
 * 纯副作用、无状态；无 DOM 环境（Node 单测）自动 no-op。返回是否真的写了（便于测试断言）。
 */
export function applyThemeMode(mode: ThemeMode, root?: HTMLElement): boolean {
  const el =
    root ?? (typeof document === 'undefined' ? undefined : (document.documentElement as HTMLElement | undefined))
  if (!el) return false
  el.classList.toggle('dark', mode === 'dark')
  el.dataset.canvasTheme = mode
  return true
}

/**
 * 主题模式运行期依赖的最小 settings 接口（内核 SettingsStore 满足）。
 * 与 themePalette 的 ThemePaletteSettingsLike 同形，独立声明以免两处彼此耦合。
 */
export interface ThemeModeSettingsLike {
  get(key: string): unknown
  onChange(cb: (key: string, value: unknown) => void): { dispose(): void }
}

/**
 * 声明主题模式进 settings（幂等：已声明过就跳过，供多宿主 / 多次 boot）。
 * @returns 是否真的声明了（拿不到 store 时返回 false）
 */
export function defineThemeModeSetting(settings: {
  has(key: string): boolean
  define(group: string, items: Record<string, SettingSchema>, scope?: string): void
}): boolean {
  if (settings.has(THEME_MODE_KEY)) return false
  settings.define(THEME_MODE_GROUP, THEME_MODE_SCHEMA, 'canvas-render')
  return true
}

/**
 * 接线：立刻按当前值落一次 DOM，并订阅后续变化实时落。
 * @param settings 内核 settings 服务（可缺省：缺省时只按默认值落一次）
 * @param root 落点，默认 `document.documentElement`（测试可传假元素）
 * @returns dispose：解除订阅（DOM 上残留的 class 由下一个主题/宿主接管，这里不清 ——
 *          主题模式是「当前值」不是「覆盖」，与色板内联变量语义不同）
 */
export function installThemeMode(
  settings: ThemeModeSettingsLike | undefined,
  root?: HTMLElement,
): () => void {
  const sync = (): void => {
    applyThemeMode(resolveThemeMode((k) => settings?.get(k)), root)
  }
  sync()
  if (!settings) return () => {}
  const off = settings.onChange((key) => {
    if (key === THEME_MODE_KEY) sync()
  })
  return () => off.dispose()
}
