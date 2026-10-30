/**
 * 「离开画布前落盘」的注册必须跟着每次宿主就绪重绑（2026-10-30 扫描发现）。
 *
 * 根因：registerPendingSave 只在 useUi() 建单例那一刻调一次，而 App.vue 卸载时
 * 调 releasePendingSave() 注销。于是：第一次离开画布 → 注销；之后切回画布时
 * 单例已存在、不会再注册 → 第二次起路由守卫 await 的是 undefined，
 * 切画布的那次 flush 静默失效（改动又可能丢）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const ui = readFileSync(new URL('../composables/ui.ts', import.meta.url), 'utf-8')
const app = readFileSync(new URL('../App.vue', import.meta.url), 'utf-8')

describe('pendingSave 注册的生命周期', () => {
  it('注册发生在宿主就绪（onReady）里，而不是建单例时只做一次', () => {
    const onReady = ui.slice(ui.indexOf('async function onReady()'), ui.indexOf('function bindAssetsChanged'))
    expect(onReady, 'onReady 没有（重新）注册落盘钩子').toMatch(/registerPendingSave\(flushCanvasSave\)/)
    // 全文件只允许这一处注册调用：再有第二处（例如停在单例创建处）就是两条注册路径。
    // 注意 unregisterPendingSave(...) 里也含同样的子串，所以按「行首是 register」数。
    const calls = ui.match(/^\s*registerPendingSave\(flushCanvasSave\)/gm)?.length ?? 0
    expect(calls, '注册入口不止一处').toBe(1)
  })

  it('注销仍然在 App 卸载时（宿主没了，钩子取不到 ctx）', () => {
    expect(app).toMatch(/ui\.releasePendingSave\(\)/)
  })
})
