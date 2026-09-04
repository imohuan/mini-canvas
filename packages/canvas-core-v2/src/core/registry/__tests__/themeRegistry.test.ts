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
