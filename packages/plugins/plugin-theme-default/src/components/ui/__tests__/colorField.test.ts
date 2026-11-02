/** ColorField 的 SSR 冒烟契约：颜色字段不能退回原生 input，第三方 Chrome 必须带 alpha 轨道。 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { Chrome } from '@ckpack/vue-color'
import ColorField from '../ColorField.vue'

describe('ColorField', () => {
  it('触发器显示棋盘格色块、规范颜色和透明度百分比，不是原生 color input', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () => h(ColorField, { modelValue: '#3b82f680', ariaLabel: '连线颜色', inputId: 'sf-edge' }),
      }),
    )
    expect(html).toContain('cf-trigger')
    expect(html).toContain('id="sf-edge"')
    expect(html).toContain('#3b82f680')
    expect(html).toContain('50%')
    expect(html).toContain('cf-swatch')
    expect(html).not.toContain('type="color"')
  })

  it('第三方 Chrome 取色器带透明度轨道和棋盘格（用户可见、可调）', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(Chrome, { modelValue: '#3b82f680' }) }),
    )
    expect(html).toContain('vc-chrome-alpha-wrap')
    expect(html).toContain('vc-checkerboard')
    expect(html).toContain('vc-alpha-gradient')
  })

  /**
   * 取色面板的内边距回归（用户 2026-11-02 截图：色域四周一圈又厚又空的白边）。
   * 设色面板（SettingsSchemaField）与通用取色器各有一层尺寸/内边距；
   * 只保留外层 Popover 的 16px，内层宽度跟随容器、内衬归零，
   * 否则会叠成「两层 padding + 一个写死宽度」。
   */
  it('设置面板的颜色浮层：只留外面一层 16px，取色器自身不再固定宽度或叠加内衬', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const field = readFileSync(here + '../../settings/SettingsSchemaField.vue', 'utf8')
    expect(field).toMatch(/\.sf-color-pop\s*\{[^}]*padding:\s*16px/s)

    // ColorPicker 属于组件库，不在本包测试根的扫描范围内，按相对路径读源码。
    const picker = readFileSync(
      here + '../../../../../../ui-kit-shadcn/src/components/color-picker/ColorPicker.vue',
      'utf8',
    )
    // Vuelor 根节点自带的是 Tailwind 的 w-60 / p-4，必须经 ui.picker.root 注入类名才能覆盖。
    expect(picker).toMatch(/picker:\s*\{[^}]*root:\s*'[^']*w-full[^']*p-0/s)
    const rootStyle = picker.match(/\.mck-cp :deep\(\.mck-cp-root\)\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(rootStyle).toMatch(/padding:\s*0/)
    expect(rootStyle).toMatch(/width:\s*100%/)
  })

  /**
   * 颜色行回归（用户 2026-11-02 截图）：
   * 1. 以前颜色行是 stacked（标签在上、控件在下），用户要求改成左右布局；
   * 2. 右侧常驻的「清除」文字按钮要改成 hover 时右上角浮出的小叉，
   *    而且不能因为多这一个按钮把控件列撑宽。
   */
  it('颜色行左右布局，清除是悬停才出现的角标，不是常驻文字按钮', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const field = readFileSync(here + '../../settings/SettingsSchemaField.vue', 'utf8')

    // 颜色分支不能再带 stacked
    const colorBranch = field.slice(
      field.indexOf("entry.schema.type === 'color'"),
      field.indexOf("<!-- 文本（默认兜底） -->"),
    )
    expect(colorBranch).toMatch(/ShadcnSettingsRow/)
    expect(colorBranch).not.toMatch(/\sstacked\b/)

    // 清除是绝对定位的角标，默认隐藏、悬停或聚焦时显示
    expect(colorBranch).toContain('sf-color-clear')
    expect(colorBranch).not.toMatch(/>\s*清除\s*</)

    const clearStyle = field.match(/\.sf-color-clear\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(clearStyle).toMatch(/position:\s*absolute/)
    expect(clearStyle).toMatch(/opacity:\s*0/)
    expect(clearStyle).toMatch(/visibility:\s*hidden/)
  })

  /**
   * 圆角回归（用户 2026-11-02 截图：「所有 select 的圆角没有生效」）：
   * 设置字段自己写死 var(--radius-control) 会压过组件库的全局圆角规则，
   * 必须让它们走 --mct-radius。下拉触发器 / 输入框 / 数字框都不例外。
   */
  it('设置字段的圆角走全局 --mct-radius，不再写死 --radius-control', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const field = readFileSync(here + '../../settings/SettingsSchemaField.vue', 'utf8')

    for (const cls of ['sf-select-trigger', 'sf-input', 'sf-number-input']) {
      const block = field.match(new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}', 's'))?.[1] ?? ''
      expect(block, cls + ' should exist').not.toMatch(/border-radius:/)
    }

    // 组件库的宿主样式必须回落到项目 token，而不是 revert-layer
    const host = readFileSync(here + '../../../../../../ui-kit-shadcn/src/styles/host.css', 'utf8')
    expect(host).not.toMatch(/border-radius:\s*var\(--mct-radius,\s*revert-layer\)/)
    expect(host).toMatch(/\[data-slot='select-trigger'\][\s\S]{0,200}var\(--radius-control/)
  })

  /**
   * 下拉内边距回归（用户 2026-11-02：「下拉菜单内部的 padding 被你吃了」）。
   * SelectContent 是唯一漏写 p-1.5 的菜单容器：DropdownMenu / ContextMenu /
   * Menubar 都有，只有它贴边。这条锁住四者一致。
   */
  it('SelectContent 与其它菜单容器一样带 6px 内边距', () => {
    const here = fileURLToPath(new URL('.', import.meta.url))
    const kit = here + '../../../../../../ui-kit-shadcn/src/components/ui/'
    const read = (rel: string): string => readFileSync(kit + rel, 'utf8')

    const select = read('select/SelectContent.vue')
    // 只看 class 字符串：p-1.5 不能出现在注释里糊弄过去
    const classList = select.match(/'bg-popover[^']*'/)?.[0] ?? ''
    expect(classList).toContain('p-1.5')

    for (const rel of [
      'dropdown-menu/DropdownMenuContent.vue',
      'context-menu/ContextMenuContent.vue',
      'menubar/MenubarContent.vue',
    ]) {
      expect(read(rel)).toContain('p-1.5')
    }
  })
})
