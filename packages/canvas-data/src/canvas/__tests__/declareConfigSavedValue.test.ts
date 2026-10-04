/**
 * declareConfig 与「已保存值」的交互（用户报的 bug：小地图宽高改了刷新就回退）。
 *
 * 场景：插件是**运行期热装**的（云端清单装进来的那些，如 mini-map）。刷新时宿主先按本地后端
 * 恢复设置（含用户改过的 miniMapWidth），随后热装插件、内核调 declareConfig 把它的 Config
 * 声明进 settings 单一数据源。若此时用 schema 默认值覆盖，用户值就没了 —— 表现为「改了刷新就回退」。
 *
 * 这里用真实的 canvas 能力层（Context 默认装）+ 真实 SettingsStore 走一遍。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import type { SettingsStore } from '@mini-canvas/kernel'
import type { PluginModule } from '@mini-canvas/kernel'

/** 小地图同形的插件：一个数字配置项，声明进「常规/小地图」组 */
const miniMapLike: PluginModule = {
  name: 'mini-map',
  Config: {
    miniMapWidth: { type: 'number', default: 240, min: 120, max: 400, step: 10, label: '宽度', group: '常规/小地图' },
  },
  apply() {},
}

describe('热装插件的 Config 声明不得覆盖已保存值', () => {
  it('先注入保存快照，再热装插件 → 用户值保留（不被 schema 默认盖掉）', async () => {
    const ctx = new Context()
    await ctx.start()
    const settings = ctx.get<SettingsStore>('settings')
    // 模拟启动恢复：宿主把上次保存的值注入快照（此刻插件还没声明这项）
    settings.setSavedSnapshot({ miniMapWidth: 320 })

    // 运行期热装插件 → 内核 declareConfig 声明 miniMapWidth
    ctx.installPlugin(miniMapLike)
    await new Promise((r) => setTimeout(r, 0))

    // 用户值必须保留（此前会被 schema 默认 240 覆盖 → 刷新即回退）
    expect(settings.get('miniMapWidth')).toBe(320)
  })

  it('插件声明的项没有保存值时，用 schema 默认（不能反向把默认当用户值存起来）', async () => {
    const ctx = new Context()
    await ctx.start()
    const settings = ctx.get<SettingsStore>('settings')
    settings.setSavedSnapshot({}) // 注入过快照但这项没有
    ctx.installPlugin(miniMapLike)
    await new Promise((r) => setTimeout(r, 0))
    expect(settings.get('miniMapWidth')).toBe(240)
  })
})
