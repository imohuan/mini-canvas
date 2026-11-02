import { watchEffect, type Ref } from 'vue'
import { resolveThemeVars, type ThemeSelection } from './colors'
import { findFont, loadFont, type RadiusOption } from './fonts'
import { sizeCssVars, type SizeOption } from './sizes'

export interface PreviewThemeConfig extends ThemeSelection {
  font: string
  heading: string
  radius: RadiusOption
  /** 控件尺寸档位；不传表示各组件按自己的 size prop */
  size: SizeOption['id'] | 'inherit'
}

/** 上一轮写在 `<html>` 上的内联变量（换主题前先摘干净）。 */
let writtenVars: string[] = []

/** 把主题选择实时写到 `<html>` 的内联变量上（浮层 Teleport 到 body 也能读到）。 */
export function useThemePreview(config: Ref<PreviewThemeConfig>, dark: Ref<boolean>): void {
  watchEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const vars = resolveThemeVars(config.value)
    const scheme = dark.value ? vars.dark : vars.light

    // 先清掉上一次写过的内联变量：切换 Base Color 时，旧键（比如 sidebar-*）不能残留。
    for (const name of writtenVars) root.style.removeProperty(name)
    writtenVars = []
    for (const [name, value] of Object.entries(scheme)) {
      root.style.setProperty(`--${name}`, value)
      writtenVars.push(`--${name}`)
    }

    const body = findFont(config.value.font)
    loadFont(body)
    root.style.setProperty('--font-body', `'${body.family}', ${body.fallback}`)
    writtenVars.push('--font-body')

    if (config.value.heading === 'inherit') {
      root.style.setProperty('--font-heading-font', `var(--font-body)`)
    } else {
      const heading = findFont(config.value.heading)
      loadFont(heading)
      root.style.setProperty('--font-heading-font', `'${heading.family}', ${heading.fallback}`)
    }

    writtenVars.push('--font-heading-font')
    root.style.setProperty('--radius', config.value.radius.value)
    writtenVars.push('--radius')

    // 尺寸档位：与真实应用同一套 data 属性 + --mct-size-* 变量（见 styles/size.css）
    if (config.value.size === 'inherit') {
      root.removeAttribute('data-mct-size')
    } else {
      root.setAttribute('data-mct-size', config.value.size)
      for (const [name, value] of Object.entries(sizeCssVars(config.value.size))) {
        root.style.setProperty(name, value)
        writtenVars.push(name)
      }
    }
  })
}

/** 面板上的「复制 CSS」用：导出当前选择对应的变量块。 */
export function exportThemeCss(config: PreviewThemeConfig): string {
  const vars = resolveThemeVars(config)
  const body = findFont(config.font)
  const heading = config.heading === 'inherit' ? 'var(--font-body)' : `'${findFont(config.heading).family}', sans-serif`
  const block = (scheme: Record<string, string>): string =>
    Object.entries(scheme)
      .map(([name, value]) => `  --${name}: ${value};`)
      .join('\n')
  return [
    ':root {',
    `  --font-body: '${body.family}', ${body.fallback};`,
    `  --font-heading-font: ${heading};`,
    `  --radius: ${config.radius.value};`,
    block(vars.light),
    '}',
    '',
    '.dark {',
    block(vars.dark),
    '}',
  ].join('\n')
}
