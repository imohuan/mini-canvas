import { describe, it, expect } from 'vitest'
import { Context } from '../Context'
import { ThemeRegistry } from '../registry/themeRegistry'
import type { PluginScope, PluginModule } from '../types'

/**
 * 目标 B2 验收级宿主测试（无 Vue，纯内核）：
 * 主题插件用 ctx.settings 声明分组配置 + ctx.settings.onChange 按作用域订阅，
 * 改配置只在"对应那一处"做窄更新(改 edgeColor 只刷 edge 主题、不动 nodeShell occupant)，无全图重建；
 * 另一个插件改自己的配置不触发本插件。
 */

const MyEdge = { name: 'MyEdge' }
const MyShell = { name: 'MyShell' }

/** 造一个宿主 ctx：注入 themeRegistry，start 触发插件 */
async function bootTheme(...plugins: PluginModule[]): Promise<{ ctx: Context; theme: ThemeRegistry }> {
  const ctx = new Context()
  const theme = new ThemeRegistry()
  ctx.inject('themeRegistry', theme)
  for (const p of plugins) ctx.plugin(p)
  await ctx.start()
  return { ctx, theme }
}

describe('B2：插件 settings 窄更新 + 按作用域订阅（宿主级验收）', () => {
  it('主题插件：改 edgeColor 只刷 edge 一处，nodeShell occupant 不受影响(无全图重建)', async () => {
    // 模拟"edge 主题占用"就地更新的样式对象(改配置只改它，不重建任何 occupant/节点数据)
    const edgeStyle = { stroke: '#b1b1b7', width: 1 }

    const themePlugin: PluginModule = {
      name: 'theme-default',
      apply(ctx: PluginScope) {
        // ① 申报两组配置(含 color/number schema)
        ctx.settings.define({
          group: '连线',
          items: {
            edgeColor: { type: 'color', default: '#b1b1b7', label: '连线颜色' },
            edgeWidth: { type: 'number', default: 1, min: 0, max: 10, label: '线宽' },
          },
        })
        ctx.settings.define({ group: '基础', items: { corner: { type: 'number', default: 8, min: 0, max: 40, label: '圆角' } } })
        // 主题注册 edge 与 nodeShell 两个 occupants
        ctx.theme.register('edge', MyEdge)
        ctx.theme.register('nodeShell', MyShell)
        // ② 只订自己这插件、且只更新"对应那一处"：改 edgeColor/edgeWidth → 只刷 edge 样式对象
        ctx.settings.onChange('theme-default', () => {
          if (ctx.settings.get('edgeColor')) {
            edgeStyle.stroke = String(ctx.settings.get('edgeColor'))
            edgeStyle.width = Number(ctx.settings.get('edgeWidth'))
          }
        })
      },
    }
    const { ctx, theme } = await bootTheme(themePlugin)
    expect(theme.occupantIds('nodeShell')).toHaveLength(1)

    const edgeId = theme.occupantIds('edge')[0]
    ctx.settings.set('edgeColor', '#ff0000')
    // edge 样式就地更新；nodeShell occupant 与 edge occupant 都原样(无重挂/重建)
    expect(edgeStyle.stroke).toBe('#ff0000')
    expect(theme.winner('nodeShell')).toBe(MyShell)
    expect(theme.occupantIds('nodeShell')).toHaveLength(1)
    expect(theme.occupantIds('edge')).toEqual([edgeId])
    // 越界夹取(线宽 99 → 10)
    ctx.settings.set('edgeWidth', 99)
    expect(edgeStyle.width).toBe(10)
  })

  it('另一插件改自己配置不触发本插件(按作用域订阅)', async () => {
    let themeCalls = 0
    const themePlugin: PluginModule = {
      name: 'theme-default',
      apply(ctx: PluginScope) {
        ctx.settings.define({ group: 'g', items: { mine: { type: 'color', default: '#000' } } })
        ctx.settings.onChange('theme-default', () => void themeCalls++)
      },
    }
    const otherPlugin: PluginModule = {
      name: 'other',
      apply(ctx: PluginScope) {
        ctx.settings.define({ group: 'o', items: { theirs: { type: 'color', default: '#fff' } } })
      },
    }
    const { ctx } = await bootTheme(themePlugin, otherPlugin)
    ctx.settings.set('theirs', '#123') // other 改自己的 → theme-default 不触发
    expect(themeCalls).toBe(0)
    ctx.settings.set('mine', '#999') // theme-default 改自己的 → 触发
    expect(themeCalls).toBe(1)
  })
})
