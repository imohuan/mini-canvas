/**
 * useThemeColor —— 取色板的**响应式当前值**（JS 通道）。
 *
 * 什么时候需要它：消费方吃不到 CSS 变量的地方。
 * - SVG **表现属性/渐变 stop**：`setAttribute('stop-color', 'var(--x)')` 不生效
 *   （var() 只在 CSS 声明里解析，表现属性不认）—— 光斑渐变就是这种；
 * - canvas 2D（`ctx.fillStyle`）、`foreignObject` 里塞的样式、需要把色值算进几何的地方。
 *
 * 什么时候**不要**用它：能写 CSS 的地方一律 `var(--ui-xxx, 兜底)` ——
 * 纯 CSS 切主题零 JS、零重渲染，比经 JS 转一手更快也更不容易漏。
 * 判断标准：这个值最终是不是"一个 CSS 声明"？是 → 走 CSS；不是（要喂给 API/属性）→ 用本函数。
 *
 * 响应两件事（两件都必须跟，漏一个就会出现"改了没反应"）：
 * ① 用户在设置面板改色 → settings.onChange；
 * ② 切亮/暗主题 → `<html class="dark">` 变化（见 watchThemeMode）。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useCanvasRender } from './renderContext'
import {
  currentThemeMode,
  resolveThemeColorValue,
  watchThemeMode,
  type ThemeColorMode,
  type ThemePaletteSettingsLike,
} from './themePalette'

/**
 * 取某个色板 token 在当前主题下的颜色（响应式）。
 *
 * 必须在 `<CanvasHost>` 渲染子树内调用（用的是 useCanvasRender 的 ctx）；
 * 读不到 settings（极简宿主/单测桩）时回落 token 默认值，不抛错。
 *
 * @param tokenKey 色板基名（如 'edgeRailColor'），见 THEME_COLOR_TOKENS
 * @param root 主题 class 所在元素，默认 `document.documentElement`（测试可传假元素）
 */
export function useThemeColor(tokenKey: string, root?: Element | null): Ref<string> {
  const { ctx } = useCanvasRender()
  const settings = ctx.get<ThemePaletteSettingsLike | undefined>('settings')

  const read = (mode: ThemeColorMode): string =>
    resolveThemeColorValue((k) => settings?.get(k), tokenKey, mode) ?? ''

  const color = ref(read(currentThemeMode(root)))

  const disposers: Array<() => void> = []

  if (settings && typeof settings.onChange === 'function') {
    const off = settings.onChange(() => {
      color.value = read(currentThemeMode(root))
    })
    disposers.push(() => off.dispose())
  }

  disposers.push(watchThemeMode((mode) => {
    color.value = read(mode)
  }, root))

  onBeforeUnmount(() => {
    for (const dispose of disposers) dispose()
  })
  return color
}
