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
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apply, name, inject } from '../index'
import { apply as applyDemoNodes, name as demoNodesName } from '../demoNodes'

describe('插件身份', () => {
  it('名字与依赖：theme-gallery，不依赖任何服务', () => {
    expect(name).toBe('theme-gallery')
    expect(inject).toEqual([])
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

