/**
 * 预览页配置必须真的落到「生效的位置」。
 *
 * 用户口径：顶部改了一项，下面组件却纹丝不动 = 这个配置没用。
 * 实测踩到过两次：
 * 1. 预览页直接 import 组件，绕过了 `withComponentConfig`，改尺寸页面没反应；
 * 2. 圆角只写 `--radius`，而 Tailwind 的 `rounded-*` 在构建期就写死了，改变量无效。
 *
 * 这里守住「配置 → 生效路径」的接线，不测浏览器像素（那部分在 Chrome 里目验）。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  DEFAULT_COMPONENT_CONFIG,
  componentConfig,
  resetComponentConfig,
} from '../componentConfig'
import { applyThemePreview, type PreviewThemeConfig } from '../theme/useThemePreview'

const here = path.dirname(fileURLToPath(import.meta.url))
const srcRoot = path.resolve(here, '..')

const baseConfig: PreviewThemeConfig = {
  baseColor: 'neutral',
  theme: 'neutral',
  font: 'inter',
  heading: 'inherit',
  radius: 'large',
  size: 'default',
  arrowVisible: false,
  gap: 8,
  offset: 0,
  subGap: 8,
}

/** 假 style 容器：只记 setProperty / removeProperty。 */
function fakeRoot() {
  const map = new Map<string, string>()
  return {
    el: {
      style: {
        setProperty: (name: string, value: string) => void map.set(name, value),
        removeProperty: (name: string) => void map.delete(name),
      },
    } as unknown as HTMLElement,
    map,
  }
}

beforeEach(() => resetComponentConfig())

describe('预览页配置落到生效位置', () => {
  it('行为类配置（尺寸 / 箭头 / 间距 / 偏移 / 二级菜单间距）写进 componentConfig', () => {
    applyThemePreview(
      { ...baseConfig, size: 'lg', arrowVisible: true, gap: 16, offset: 4, subGap: 20 },
      false,
    )
    expect(componentConfig.size).toBe('lg')
    expect(componentConfig.arrowVisible).toBe(true)
    expect(componentConfig.gap).toBe(16)
    expect(componentConfig.offset).toBe(4)
    expect(componentConfig.subGap).toBe(20)
  })

  it('样式类配置（颜色 / 字体 / 圆角）写成 CSS 变量', () => {
    const { el, map } = fakeRoot()
    applyThemePreview({ ...baseConfig, theme: 'violet', font: 'roboto' }, false, el)
    expect(map.get('--primary')).toBeTruthy()
    expect(map.get('--font-body')).toContain('Roboto')
    // 标题「跟随正文」写的是 var 引用，正文换了标题一起换
    expect(map.get('--font-heading-font')).toBe('var(--font-body)')
    expect(map.get('--radius')).toBe('0.875rem')
  })

  it('切暗色会换成暗色那一套变量，而不是继续写亮色', () => {
    const light = fakeRoot()
    const dark = fakeRoot()
    applyThemePreview(baseConfig, false, light.el)
    applyThemePreview(baseConfig, true, dark.el)
    expect(light.map.get('--background')).not.toBe(dark.map.get('--background'))
  })

  it('旧值会被摘掉：从「大圆角」切回默认档不会留下上一条 --radius', () => {
    const { el, map } = fakeRoot()
    applyThemePreview({ ...baseConfig, radius: 'large' }, false, el)
    expect(map.has('--radius')).toBe(true)
    applyThemePreview({ ...baseConfig, radius: 'default' }, false, el)
    expect(map.get('--radius')).toBe('0.625rem')
  })
})

describe('预览页的接线（静态检查）', () => {
  it('App.vue 从 previewKit 取组件，而不是直接 import components/ui', () => {
    const app = readFileSync(path.join(srcRoot, 'App.vue'), 'utf-8')
    // 直接 import '@/components/ui/...' 就绕过了 size 注入薄层
    expect(app).not.toMatch(/from '@\/components\/ui\//)
    expect(app).toMatch(/from '@\/previewKit'/)
  })

  it('previewKit 对每个导出都套了 withComponentConfig', () => {
    const kit = readFileSync(path.join(srcRoot, 'previewKit.ts'), 'utf-8')
    expect(kit).toMatch(/withComponentConfig/)
    expect(kit).toMatch(/configure\(buttonModule, 'Button'\)/)
  })

  it('预览页的每个 .vue（含配置条 / 字体下拉 / 取色器）都不直接 import 组件', () => {
    /*
     * 用户口径 2026-11-04：改「控件尺寸」时，顶部配置条自己的按钮却不跟着变。
     * 原因就是这些文件直接 import 组件，绕过了注入 size 的薄层。
     * 这里把所有预览用到的 .vue 都扫一遍，防止再漏。
     */
    const files = [
      'App.vue',
      'theme/ThemeConfigBar.vue',
      'theme/FontSelect.vue',
      'components/color-picker/ColorPicker.vue',
      'components/color-picker/ColorPickerSelect.vue',
    ]
    for (const rel of files) {
      const source = readFileSync(path.join(srcRoot, rel), 'utf-8')
      expect(source, rel + ' 必须走 @/previewKit 或底层 reka-ui').not.toMatch(
        /from '@\/components\/(ui|color-picker)\//,
      )
    }
  })

  it('预览页不写死 size 档位（否则调用点会盖掉全局尺寸）', () => {
    for (const rel of ['App.vue', 'theme/ThemeConfigBar.vue', 'theme/FontSelect.vue']) {
      const source = readFileSync(path.join(srcRoot, rel), 'utf-8')
      // 允许 size="icon-sm" 这类图标按钮；只禁 sm / default / lg 三档
      expect(source, rel).not.toMatch(/size="(sm|default|lg)"/)
    }
  })

  it('预览样式直接读 --radius，不依赖构建期写死的 rounded-* 工具类', () => {
    const css = readFileSync(path.join(srcRoot, 'assets', 'index.css'), 'utf-8')
    expect(css).toMatch(/\[data-slot='button'\][\s\S]{0,400}border-radius:\s*var\(--radius/)
    expect(css).toMatch(/\[data-slot='card'\][\s\S]{0,300}border-radius:\s*calc\(var\(--radius/)
  })

  it('默认配置没被预览页偷偷改掉', () => {
    expect(DEFAULT_COMPONENT_CONFIG.gap).toBe(8)
    expect(DEFAULT_COMPONENT_CONFIG.arrowVisible).toBe(false)
  })
})
