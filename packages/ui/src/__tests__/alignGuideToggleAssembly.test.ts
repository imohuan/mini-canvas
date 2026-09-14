/**
 * 对齐辅助线「总开关」的整装验证（真实插件模块 + 真实内核，跑的是 apply 本身）。
 *
 * 放在 ui 包的原因与 nodePluginsAssembly 相同：只有装配层能装载真实插件模块（内核不能反向依赖插件），
 * 且本包的 vitest 配了 vue 插件，才能 import 到 .vue 浮层。
 *
 * 需求的落点在这里：**只有开着这个开关，插件才生效**。浮层组件就是本插件的全部实现
 * （订阅拖拽 → 算吸附 → 写 updateNodeVisual → 画参考线），所以断言"overlay 槽里有没有它"
 * 就等于断言"关掉以后拖节点不会吸附、不会出参考线"：
 * - 默认开：槽里有它（浮层挂载 = 生效）；
 * - 关掉：槽里没有（浮层卸载 = 不生效，且不再监听拖拽）；
 * - 再打开：槽里又有（可恢复，不必重载画布）；
 * - 装配时就关：从头到尾不出现（插件的存在不产生任何效果）。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { alignGuidePlugin } from '@mini-canvas/plugin-align-guide'

/** overlay 槽里本插件浮层的 occupant id */
const SLOT_ID = 'align-guide'

async function boot(raw?: unknown) {
  const ctx = new Context()
  ctx.plugin(alignGuidePlugin, raw)
  await ctx.start()
  const slotIds = () => ctx.slots.occupants('overlay').map((o) => o.id)
  return { ctx, slotIds }
}

describe('对齐辅助线总开关（真实插件装配）', () => {
  it('默认开启：浮层注册进 overlay 槽（拖节点会吸附并画参考线）', async () => {
    const { ctx, slotIds } = await boot()
    expect(slotIds()).toContain(SLOT_ID)
    ctx.stop()
  })

  it('设置面板关掉 → 浮层从槽里消失；再打开 → 回来（实时生效，不需重载）', async () => {
    const { ctx, slotIds } = await boot()
    expect(slotIds()).toContain(SLOT_ID)

    ctx.settings.set('alignGuideEnabled', false)
    expect(slotIds()).not.toContain(SLOT_ID)

    ctx.settings.set('alignGuideEnabled', true)
    expect(slotIds()).toContain(SLOT_ID)
    ctx.stop()
  })

  it('装配时已关掉：从头到尾不出现（插件装了也不产生效果）', async () => {
    const { ctx, slotIds } = await boot({ alignGuideEnabled: false })
    expect(slotIds()).not.toContain(SLOT_ID)
    ctx.stop()
  })

  it('关闭状态下热卸插件：不报错、槽保持干净', async () => {
    const { ctx, slotIds } = await boot({ alignGuideEnabled: false })
    expect(ctx.uninstallPlugin('align-guide')).toBe(true)
    expect(slotIds()).not.toContain(SLOT_ID)
    ctx.stop()
  })

  it('关掉后卸载插件：浮层已被摘除，卸载不留悬挂引用（stop 后槽清空）', async () => {
    const { ctx, slotIds } = await boot()
    ctx.settings.set('alignGuideEnabled', false)
    ctx.stop()
    expect(slotIds()).not.toContain(SLOT_ID)
  })
})
