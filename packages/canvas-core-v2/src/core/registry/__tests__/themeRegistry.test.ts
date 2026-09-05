import { describe, it, expect } from 'vitest'
import { Context } from '../../Context'
import { ThemeRegistry } from '../themeRegistry'
import { registerThemeSlot } from '../registerThemeSlot'
import type { PluginScope } from '../../types'

/** 测试组件 stub（opaque 句柄即可，内核不 import Vue） */
const MyEdge = { name: 'MyEdge' }
const MyBg = { name: 'MyBg' }
const MyShell = { name: 'MyShell' }

/** 造一个能跑插件 setup 的最小 ctx：注入 themeRegistry，start 触发 setup */
async function bootWithSetup(setup: (ctx: PluginScope) => void): Promise<{ ctx: Context; theme: ThemeRegistry }> {
  const ctx = new Context()
  const theme = new ThemeRegistry()
  ctx.inject('themeRegistry', theme)
  ctx.plugin({ name: 'under-test', setup })
  await ctx.start()
  return { ctx, theme }
}

describe('ThemeRegistry（画布外观槽位注册表）', () => {
  it('register/get/unregister 基本读写 + 防重复', () => {
    const t = new ThemeRegistry()
    t.register('edge', MyEdge)
    t.register('background', MyBg)
    expect(t.get('edge')).toBe(MyEdge)
    expect(t.has('background')).toBe(true)
    expect(() => t.register('edge', MyEdge)).toThrow(/already registered/)
    t.unregister('edge')
    expect(t.get('edge')).toBeUndefined()
    t.unregister('edge') // 幂等
  })

  it('set 覆盖式重设、slots 列出已注册', () => {
    const t = new ThemeRegistry()
    t.set('edge', MyEdge)
    t.set('edge', MyBg) // 覆盖
    expect(t.get('edge')).toBe(MyBg)
    expect(t.slots()).toEqual(['edge'])
  })
})

describe('ThemeRegistry（基于 SlotRegistry 的多 occupant 开放槽）', () => {
  it('一槽可叠多 occupant，winner = order 最小者', () => {
    const t = new ThemeRegistry()
    t.register('edge', MyEdge) // default occupant (order 0)
    t.addOccupant('edge', { id: 'neon', order: -1, value: MyBg }) // 更高优先级(order 更小)
    t.addOccupant('edge', { id: 'alt', order: 5, value: MyShell })
    // winner = order 最小的 neon
    expect(t.winner('edge')).toBe(MyBg)
    expect(t.get('edge')).toBe(MyBg)
    // occupants 按 order 全量列出
    expect(t.occupants('edge').map((o) => o.value)).toEqual([MyBg, MyEdge, MyShell])
    expect(t.occupantIds('edge')).toEqual(expect.arrayContaining(['neon', 'default', 'alt']))
  })

  it('remove 一个 occupant 不影响同槽其它（顶替后热卸回退）', () => {
    const t = new ThemeRegistry()
    t.register('edge', MyEdge) // 默认主题：id=default
    const customId = t.addOccupant('edge', { id: 'custom-shell', order: -10, value: MyBg })
    expect(t.winner('edge')).toBe(MyBg) // 自定义顶替默认
    expect(t.removeOccupant('edge', customId)).toBe(true)
    expect(t.winner('edge')).toBe(MyEdge) // 回退到默认
    expect(t.removeOccupant('edge', customId)).toBe(false) // 幂等 no-op
    // 只卸默认不回退其它已叠 occupant
    expect(t.unregister('edge')).toBeUndefined()
    expect(t.hasOccupant('edge')).toBe(false)
  })

  it('同 id addOccupant 替换该格、不新增', () => {
    const t = new ThemeRegistry()
    t.addOccupant('edge', { id: 'x', order: 1, value: MyEdge })
    t.addOccupant('edge', { id: 'x', order: 2, value: MyBg }) // 同 id → 替换
    expect(t.occupantIds('edge')).toEqual(['x'])
    expect(t.occupants('edge').map((o) => o.value)).toEqual([MyBg])
    expect(t.occupants('edge')[0].order).toBe(2)
  })

  it('插件可声明新槽（槽名不限枚举）', () => {
    const t = new ThemeRegistry()
    t.addOccupant('canvas.overlay', { id: 'scanline', value: MyBg })
    t.addOccupant('canvas.overlay', { id: 'grid', order: 1, value: MyEdge })
    expect(t.hasOccupant('canvas.overlay')).toBe(true)
    expect(t.occupants('canvas.overlay').length).toBe(2)
    expect(t.winner('canvas.overlay')).toBe(MyBg)
    expect(t.slots()).toContain('canvas.overlay')
  })

  it('旧 register 对新槽空槽仍可注册 default occupant', () => {
    const t = new ThemeRegistry()
    t.register('nodeShell', MyShell)
    expect(t.winner('nodeShell')).toBe(MyShell)
    expect(() => t.register('nodeShell', MyEdge)).toThrow(/already registered/)
  })
})

describe('registerThemeSlot（主题插件"替换一块 UI"接缝）', () => {
  it('setup 里注册 edge/background/nodeShell 进 themeRegistry', async () => {
    const { theme } = await bootWithSetup((ctx) => {
      registerThemeSlot(ctx, 'edge', MyEdge)
      registerThemeSlot(ctx, 'background', MyBg)
      registerThemeSlot(ctx, 'nodeShell', MyShell)
      registerThemeSlot(ctx, 'edgeDefaultType', 'custom')
    })
    expect(theme.get('edge')).toBe(MyEdge)
    expect(theme.get('background')).toBe(MyBg)
    expect(theme.get('nodeShell')).toBe(MyShell)
    expect(theme.get('edgeDefaultType')).toBe('custom')
  })

  it('插件卸载(stop)时槽位自动注销回退默认', async () => {
    const { ctx, theme } = await bootWithSetup((ctx) => {
      registerThemeSlot(ctx, 'edge', MyEdge)
      registerThemeSlot(ctx, 'background', MyBg)
    })
    expect(theme.get('edge')).toBe(MyEdge)
    ctx.stop()
    expect(theme.get('edge')).toBeUndefined()
    expect(theme.get('background')).toBeUndefined()
  })

  it('缺 themeRegistry 服务时不抛（纯数据 ctx）', async () => {
    const ctx = new Context()
    ctx.plugin({
      name: 'p',
      setup(c) {
        registerThemeSlot(c, 'edge', MyEdge)
      },
    })
    await expect(ctx.start()).resolves.toBeUndefined()
  })
})
