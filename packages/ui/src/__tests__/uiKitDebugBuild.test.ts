/**
 * 组件库使用标记在**构建版**里也必须可用。
 *
 * 用户口径（2026-11-02）：在 127.0.0.1:8865 的设置里打开「组件库使用标记」，
 * 完全看不到圆点。根因是当时整条链路只在 dev 下启用：
 *   ① App.vue 用 import.meta.env.DEV ? … : null 把调试层置空；
 *   ② Vite 插件 apply:'serve'，构建版不注入定位属性；
 *   ③ 默认主题只在 DEV 下包透明标记层。
 * 换句话说，构建版里开关、调试层、属性三者一个都不在。
 *
 * 这三条都属于「安静失效」——界面上没有任何报错线索，所以用源码断言钉住。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const APP = readFileSync(new URL('../App.vue', import.meta.url), 'utf-8')
/** 只看代码、不看注释：注释里会引用旧的 DEV 写法作为说明 */
const APP_CODE = APP.replace(/\/\*[\s\S]*?\*\//g, '')
const PLUGIN = readFileSync(
  new URL(
    '../../../ui-kit-shadcn/src/vite-plugin-debug-loc.ts',
    import.meta.url,
  ),
  'utf-8',
)
const PLUGIN_CODE = PLUGIN.replace(/\/\*[\s\S]*?\*\//g, '')
const THEME = readFileSync(
  new URL('../../../plugins/plugin-theme-components/src/index.ts', import.meta.url),
  'utf-8',
)
const THEME_CODE = THEME.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('组件库使用标记：构建版可用', () => {
  it('App.vue 不再用 DEV 把调试层置空', () => {
    // 只要有 `import.meta.env.DEV ?` 包住 UiKitDebugOverlay，构建版就必然是 null
    expect(APP_CODE).not.toMatch(/UiKitDebugOverlay\s*=\s*import\.meta\.env\.DEV/)
    // 调试层按名从 ui 目录取（主题登记）；不再由 App.vue 直接 import 某一份实现，
    // 因此换主题时调试层也跟着换，且构建版不会因为 DEV 判断变成 null。
    expect(APP_CODE).toContain("useUiComponentOutside('uiKitDebugOverlay')")
    expect(APP_CODE).not.toContain('plugin-theme-components/components/ui/UiKitDebugOverlay.vue')
    expect(APP_CODE).toMatch(/<component[^>]*:is="UiKitDebugOverlay"/)
  })

  it('Vite 插件不再只在 serve 生效', () => {
    expect(PLUGIN_CODE).not.toMatch(/apply:\s*'serve'/)
    expect(PLUGIN_CODE).toMatch(/name:\s*'mini-canvas:ui-kit-debug-loc'/)
  })

  it('默认主题登记 shadcn 组件时始终包透明标记（不按 DEV 分支）', () => {
    expect(THEME_CODE).toMatch(/withUiKitDebugMark\(/)
    expect(THEME_CODE).not.toMatch(/const isDev = \(import\.meta/)
  })

  it('默认主题把调试层登记进 ui 目录（换主题时一起换）', () => {
    const COMPONENTS = readFileSync(
      new URL('../../../plugins/plugin-theme-components/src/index.ts', import.meta.url),
      'utf-8',
    )
    expect(COMPONENTS).toContain('ui.add("uiKitDebugOverlay"')
  })
})

