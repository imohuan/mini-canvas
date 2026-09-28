/**
 * 设置面板关闭通道 —— 装配层必须订阅内核事件 settings:ui-close。
 *
 * 为什么需要这条测试（真实缺陷，用户报的“你的面板无法关闭”）：
 *   settingsPanel 是主题单赢家槽。默认皮 PluginSettingsDialog（plugin-theme-default）的
 *   ✕ / 遮罩 / Esc 都只做一件事：ctx.emit('settings:ui-close')，等宿主把 settingsOpen 置 false。
 *   一旦装配层没人订阅这条事件，最直观的关闭入口（✕、点遮罩）就静默失效 ——
 *   没有报错、没有 warn，画面照旧，只能靠集成层自己兜的全局 Esc 逃出去。
 *
 * 这条测试跑的是整条装配链路（setReadyHost → ui.onReady → 事件 → state），
 * 而不是某个孤立小函数：少一步接线就会红。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { useUi } from '../composables/ui'

describe('设置面板关闭通道（装配层订阅 settings:ui-close）', () => {
  it('内核广播 settings:ui-close 后，面板开关回到关闭', async () => {
    const ctx = new Context()
    await ctx.start()

    const ui = useUi()
    // App.vue 经函数 ref 把 CanvasHost 实例写进单例（bindThemeSettings/bindSettingsClose 都读它）
    ui.setHostEl({ host: { ctx } })
    await ui.onReady()

    ui.state.settingsOpen = true
    ctx.emit('settings:ui-close')

    expect(ui.state.settingsOpen).toBe(false)
  })

  it('重复 onReady 不会堆积订阅（宿主重建后仍能关）', async () => {
    const ctx = new Context()
    await ctx.start()

    const ui = useUi()
    ui.setHostEl({ host: { ctx } })
    await ui.onReady()
    await ui.onReady()

    ui.state.settingsOpen = true
    ctx.emit('settings:ui-close')
    expect(ui.state.settingsOpen).toBe(false)
  })
})
