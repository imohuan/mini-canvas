/**
 * 18 号文档的内核验收：根 Context 没有 doc 时，依赖 doc 的插件停在 PENDING；
 * 装上画布数据会话（canvas-data）后自动激活，卸载后回退 PENDING。
 *
 * 这里用最小插件模拟 canvas-data，不 import 任何画布包 —— 内核必须自己
 * 靠 inject 依赖调度完成这件事。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '../context'

describe('画布会话的 inject 生命周期', () => {
  it('没有 doc → PENDING；装会话 → ACTIVE；卸会话 → 回 PENDING', async () => {
    const ctx = new Context()
    let applied = 0
    const canvasPlugin = {
      name: 'biz-node',
      inject: ['doc'],
      apply() {
        applied += 1
      },
    }
    ctx.plugin(canvasPlugin)
    await ctx.start()
    expect(applied).toBe(0)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('pending')

    const session = {
      name: 'canvas-data',
      inject: [],
      apply(scope: { inject(name: string, impl: unknown): void }) {
        scope.inject('doc', { getNodes: () => [] })
      },
    }
    ctx.installPlugin(session)
    expect(applied).toBe(1)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('active')

    expect(ctx.uninstallPlugin('canvas-data')).toBe(true)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('pending')
    ctx.stop()
  })
})
