/**
 * 预览页的主题应用逻辑：把面板上的选择写到**真实生效的位置**。
 *
 * 分两条路（和真实应用完全一样，所以预览页的结论可以直接照搬到插件里）：
 * - `kind: 'style'` → 写 CSS 变量（颜色 / 字体 / 圆角）。组件不用改，天然实时。
 * - `kind: 'config'` → 写 `componentConfig`（size / 箭头 / 间距 / 外推量 / 二级菜单间距）。
 *   这些 CSS 表达不了：size 由注册薄层注入，其余由组件读响应式配置。
 */
import { onBeforeUnmount, watchEffect, type Ref } from 'vue'
import { resolveThemeVars, type ThemeSelection } from './colors'
import { findFont, findRadius, loadFont } from './fonts'
import {
  componentConfig,
  setComponentConfig,
  resetComponentConfig,
  type ComponentConfig,
  type ComponentSize,
} from '../componentConfig'

export interface PreviewThemeConfig extends ThemeSelection {
  /** 正文字体 id（FONT_OPTIONS 里的 id） */
  font: string
  /** 标题字体 id；`inherit` = 跟随正文 */
  heading: string
  /** 圆角档位 id（RADIUS_OPTIONS 里的 id） */
  radius: string
  /** 带 size prop 的组件的默认档 */
  size: ComponentSize
  /** 浮层是否画箭头 */
  arrowVisible: boolean
  /** 浮层与触发器的可见间距（px） */
  gap: number
  /** 在 gap 之外再推出去的量（px，累加） */
  offset: number
  /** 二级菜单与父菜单的可见间距（px） */
  subGap: number
}

/** 上一轮写在 `<html>` 上的内联变量（换主题前先摘干净，避免旧键残留）。 */
let writtenVars: string[] = []

/**
 * 把配置应用到文档：变量 + 组件配置一次写全。
 *
 * @param opts.embedded 嵌进成品应用时只写「项目里确实没别的真源」的那几项：
 *   字体 / 圆角 / 组件配置。颜色与暗色由应用的设置面板负责 —— 这里再写一套
 *   会盖掉用户选的强调色，回到画布又对不上。
 */
export function applyThemePreview(
  config: PreviewThemeConfig,
  dark: boolean,
  root?: HTMLElement,
  opts: { embedded?: boolean } = {},
): void {
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement)
  if (el) {
    for (const name of writtenVars) el.style.removeProperty(name)
    writtenVars = []

    if (!opts.embedded) {
      const vars = resolveThemeVars(config)
      const scheme = dark ? vars.dark : vars.light
      for (const [name, value] of Object.entries(scheme)) {
        el.style.setProperty(`--${name}`, value)
        writtenVars.push(`--${name}`)
      }
    }

    const body = findFont(config.font)
    loadFont(body)
    el.style.setProperty('--font-body', `'${body.family}', ${body.fallback}`)
    writtenVars.push('--font-body')

    if (config.heading === 'inherit') {
      el.style.setProperty('--font-heading-font', 'var(--font-body)')
    } else {
      const heading = findFont(config.heading)
      loadFont(heading)
      el.style.setProperty('--font-heading-font', `'${heading.family}', ${heading.fallback}`)
    }
    writtenVars.push('--font-heading-font')

    el.style.setProperty('--radius', findRadius(config.radius).value)
    writtenVars.push('--radius')
  }

  const patch: Partial<ComponentConfig> = {
    size: config.size,
    arrowVisible: config.arrowVisible,
    gap: config.gap,
    offset: config.offset,
    subGap: config.subGap,
  }
  setComponentConfig(patch)
}

/** 预览页用：配置一变就重新应用；卸载时把变量与组件配置一起还原。 */
export function useThemePreview(
  config: Ref<PreviewThemeConfig>,
  dark: Ref<boolean>,
  opts: { embedded?: boolean } = {},
): void {
  /**
   * 嵌进成品应用时，这套配置是「临时改全局」：离开展厅要把原来的值还回去。
   *
   * 不还原会有一个真问题：展厅卸载时调用 resetComponentConfig()，用户设置里选的
   * 控件尺寸 / 圆角档位被一起清成默认值，回到画布就"变小了"。
   */
  const previous = opts.embedded
    ? { ...componentConfig }
    : undefined
  const previousVars = opts.embedded
    ? ['--font-body', '--font-heading-font', '--radius'].map((name) => ({
        name,
        value: typeof document === 'undefined' ? '' : document.documentElement.style.getPropertyValue(name),
      }))
    : []

  watchEffect(() => applyThemePreview(config.value, dark.value, undefined, opts))

  onBeforeUnmount(() => {
    if (typeof document !== 'undefined') {
      for (const item of previousVars) {
        if (item.value) document.documentElement.style.setProperty(item.name, item.value)
        else document.documentElement.style.removeProperty(item.name)
      }
      for (const name of writtenVars) {
        if (!previousVars.some((v) => v.name === name)) document.documentElement.style.removeProperty(name)
      }
    }
    writtenVars = []
    // 预览页：回到组件库默认值；内嵌：还回进入前的全局配置。
    if (previous) Object.assign(componentConfig, previous)
    else resetComponentConfig()
  })
}

