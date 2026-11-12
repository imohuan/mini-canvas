/**
 * remote-plugins —— build 版本从清单装载插件时的两处关键行为。
 *
 * 都是 2026-11-11 实打实踩过的坑：
 * 1. UMD 全局对象里塞着一堆组件，整个交给内核会报 `apply is not a function`（首页白屏）；
 * 2. 清单里的可装卸件不能替用户装 —— 只装项目内置清单（builtinInstallIds）。
 */
import { describe, it, expect } from 'vitest'
import { pickBuiltinEntries, pickPluginModule } from '../remote-plugins'

describe('pickPluginModule —— 从 UMD 全局对象里取插件模块', () => {
  const plugin = { name: 'theme-canvas', apply() {} }

  it('有 moduleExport 就取那一个（全局里还有一堆组件也不影响）', () => {
    const bag = { themeCanvasPlugin: plugin, CustomEdge: {}, MovingHandle: {} }
    expect(pickPluginModule(bag, 'themeCanvasPlugin')).toBe(plugin)
  })

  it('moduleExport 指错了 → 不硬取，退化成按形状找', () => {
    const bag = { themeCanvasPlugin: plugin, CustomEdge: {} }
    expect(pickPluginModule(bag, 'notThere')).toBe(plugin)
  })

  it('全局对象自己就是模块（只导出 name/apply 的简单插件）', () => {
    expect(pickPluginModule(plugin)).toBe(plugin)
  })

  it('什么都没有 → undefined（调用方给清晰错误，而不是把整袋导出塞进内核）', () => {
    expect(pickPluginModule({ a: 1, b: {} })).toBeUndefined()
    expect(pickPluginModule(null)).toBeUndefined()
  })
})

describe('pickBuiltinEntries —— 首启只装项目内置清单', () => {
  const catalog = {
    plugins: [
      { id: 'plugin-agent', name: 'agent' },
      { id: 'plugin-cloud-client', name: 'cloud-client' },
      { id: 'plugin-mini-map', name: 'mini-map' },
    ],
    builtinInstallIds: ['plugin-agent', 'plugin-cloud-client'],
    firstInstallIds: ['plugin-cloud-client'],
  }

  it('只留内置件，用户自己挑的可装卸件不装', () => {
    expect(pickBuiltinEntries(catalog).map((e) => e.id)).toEqual(['plugin-cloud-client', 'plugin-agent'])
  })

  it('firstInstallIds 排最前（cloud-client 必须先到位，否则后台能力不可用）', () => {
    expect(pickBuiltinEntries(catalog)[0]?.id).toBe('plugin-cloud-client')
  })

  it('没有内置清单 → 一个都不装（不替用户做决定）', () => {
    expect(pickBuiltinEntries({ plugins: catalog.plugins })).toEqual([])
  })
})
