/**
 * 上下文取件只能有一份实现：canvas-render 转发 vue-render，不许再自带一份。
 *
 * 背景（18 号文档点名的坑）：canvas-render 以前自己写了一个 `useCanvasContextOrRender`，
 * 从渲染上下文回退时会造出 `api/manager = undefined` 的假上下文。两份实现并存时，
 * 从哪个路径 import 决定拿到真的还是假的 —— 这种人肉约定必须用测试钉住。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as vueRender from '@plume-canvas/vue-render/context'
import * as canvasRender from '../canvasContext'

describe('上下文取件只有一份实现', () => {
  it('canvas-render 的导出就是 vue-render 的同一个函数对象', () => {
    // 同一个函数引用 = 没有任何本地副本；只是类型收窄。
    expect(canvasRender.useCanvasContext).toBe(vueRender.useCanvasContext)
    expect(canvasRender.useCanvasContextOrRender).toBe(vueRender.useCanvasContextOrRender)
    expect(canvasRender.CANVAS_CONTEXT_KEY).toBe(vueRender.CANVAS_CONTEXT_KEY)
  })

  it('转发文件里不再出现 inject / 假上下文构造', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../canvasContext.ts', import.meta.url)),
      'utf8',
    )
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
    // 只允许类型层面的收窄，不允许再自己 implement 一遍取件。
    expect(code).not.toMatch(/\binject\s*\(/)
    expect(code).not.toMatch(/undefined as unknown as/)
  })

  /**
   * 通用件不许在 canvas-render 里再留同名门面。
   *
   * 用户 2026-11-05 指出：canvas-render 与 vue-render 有一堆同名文件（SettingsHost /
   * SettingsShell / SlotComposer / layers / uiCatalog …），翻代码时看不出哪份是真实现。
   * 现在这些路径直接从 vue-render 取，文件不再存在 —— 谁想再加回来，这条会红。
   */
  it('canvas-render 不再保留 vue-render 同名转发文件', () => {
    const root = new URL('../../', import.meta.url)
    const forbidden = [
      'components/SettingsHost.vue',
      'components/SettingsShell.vue',
      'components/settingsSource.ts',
      'components/settingsPanelTypes.ts',
      'components/SlotComposer.vue',
      'components/SlotAnchor.vue',
      'components/slotComposer.ts',
      'contracts/layers.ts',
      'contracts/uiCatalog.ts',
    ]
    for (const rel of forbidden) {
      expect(existsSync(fileURLToPath(new URL(rel, root))), rel + ' 又长回来了').toBe(false)
    }
  })
})
