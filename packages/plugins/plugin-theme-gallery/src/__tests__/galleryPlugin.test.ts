/**
 * plugin-theme-gallery 的接线守卫。
 *
 * 用户口径：想要一个"在画布 UI 上真渲染这些组件"的展厅插件 ——
 * 组件必须在**画布子树内**按名取、且真的渲染出来（组件是活的，不是截图）。
 *
 * 所以钉三件事：
 * 1. 插件往 overlay 槽登记了一个 occupant（不登记 = 画布上什么都不会出现）；
 * 2. 展厅里所有件都是 `useUiComponent(名字)` 取的（写死 import 就会绕开主题替换，
 *    展厅看到的东西不再等于插件实际拿到的东西）；
 * 3. 画布件（节点壳 / 连线 / 背景）走嵌真画布那条路 —— 附带的示例节点插件必须真的注册了类型，
 *    否则嵌的画布里一张卡都不会有（静默空画布，最难查）。
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { apply, name, inject } from '../index'
import { apply as applyDemoNodes, name as demoNodesName } from '../demoNodes'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('插件身份', () => {
  it('名字与依赖：theme-gallery，不依赖任何服务', () => {
    expect(name).toBe('theme-gallery')
    expect(inject).toEqual([])
  })
})

/**
 * 清单身份守卫（用户口径 2026-10-14：「组件展厅这个插件不应该是自带的，需要我自己安装」）。
 *
 * 「自带 / 可装卸」是两处声明同时成立的事，任一处漏了都静默出错：
 * 1. package.json 声明 miniCanvas.installable —— 后台 /plugin-catalog.json 才会把它列进
 *    「设置 → 插件 → 本地清单」，用户才有点安装的入口；
 * 2. package.json **不**声明 miniCanvas.builtin —— 声明了就进「自带」页（只读、不给装卸按钮），
 *    两个身份同时出现。
 *
 * 外加第三条：可装卸件必须打得出 UMD 产物（没有 dist 就会被清单标成"未构建"直接不列）。
 * 这三条互为印证，靠肉眼看清单很难发现漏了哪一条 —— 面板照常工作，只是用户找不到这个插件。
 */
describe('清单身份：可装卸件（不是自带件）', () => {
  const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
    miniCanvas?: { installable?: boolean; builtin?: boolean; pluginName?: string }
    scripts?: Record<string, string>
  }

  it('声明 installable，且不声明 builtin（两者语义互斥）', () => {
    expect(pkg.miniCanvas?.installable).toBe(true)
    expect(pkg.miniCanvas?.builtin).toBeUndefined()
  })

  it('pluginName 与源码导出的 name 一致（面板按它认「已装」）', () => {
    expect(pkg.miniCanvas?.pluginName).toBe(name)
  })

  it('有 build 脚本，且构建出的 UMD 产物真在 dist 里（没有 dist 就不会被清单列出）', () => {
    expect(typeof pkg.scripts?.build).toBe('string')
    // dist 是构建产物（.gitignore 里），没构建过时跳过 —— 这条卡的是"构建过却产不出可装卸件"。
    if (!existsSync(path.join(PKG_ROOT, 'dist'))) return
    const js = readFileSync(path.join(PKG_ROOT, 'dist/plugin-theme-gallery.js'), 'utf8')
    expect(js).toMatch(/\.MiniCanvasPluginThemeGallery\s*=\s*\{\}/)
  })
})

describe('apply：往 overlay 槽登记展厅', () => {
  it('登记一条 overlay occupant（id / order / 组件都在）', () => {
    const add = vi.fn()
    const ctx = {
      slots: { register: vi.fn() },
      registryOf: () => ({ add }),
    } as never

    apply(ctx)

    const register = (ctx as unknown as { slots: { register: ReturnType<typeof vi.fn> } }).slots.register
    expect(register).toHaveBeenCalledTimes(1)
    const [slot, entry] = register.mock.calls[0] as [string, { id: string; order: number; component: unknown }]
    expect(slot).toBe('overlay')
    expect(entry.id).toBe('theme-gallery-overlay')
    expect(typeof entry.order).toBe('number')
    expect(entry.component).toBeTruthy()
  })
})

describe('展厅里所有件都按名取（useUiComponent），没有写死 import', () => {
  const src = readFileSync(new URL('../ThemeGalleryOverlay.vue', import.meta.url), 'utf-8')

  it('覆盖全部 12 个设计系统件名字', () => {
    for (const n of [
      'button', 'dropdown', 'tooltip', 'select', 'slider', 'color',
      'toolParamField', 'toolParamGroup', 'toolParamGrid', 'toolParamRatio',
      'toolParamSlider', 'mediaViewer',
    ]) {
      expect(src).toContain("useUiComponent('" + n + "')")
    }
  })

  it('不直接 import 主题包的具体组件（否则会绕开主题替换）', () => {
    expect(src).not.toMatch(/from '@mini-canvas\/plugin-theme-default/)
  })

  it('画布件走嵌真画布那条路（直接塞浮层渲染不出来）', () => {
    expect(src).toContain('GalleryCanvasStage')
  })
})

describe('示例节点插件：嵌的画布里必须真有节点类型', () => {
  it('注册 demo-basic 与 demo-toolbar（含 out:top 区域）', () => {
    const register = vi.fn()
    const createNode = vi.fn(() => 'x')
    const ctx = {
      nodes: { register },
      doc: { createNode },
    } as never

    applyDemoNodes(ctx)

    expect(demoNodesName).toBe('theme-gallery-demo-nodes')
    expect(register).toHaveBeenCalledTimes(2)
    const types = register.mock.calls.map((c) => (c[0] as { type: string }).type)
    expect(types).toContain('demo-basic')
    expect(types).toContain('demo-toolbar')
    const withToolbar = register.mock.calls.map((c) => c[0] as { type: string; segments?: Record<string, unknown> })
      .find((d) => d.type === 'demo-toolbar')
    expect(withToolbar?.segments?.['out:top']).toBeTruthy()
  })
})

