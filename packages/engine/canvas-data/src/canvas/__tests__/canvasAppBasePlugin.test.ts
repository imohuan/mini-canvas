/**
 * 应用级底座 + 画布会话的拆分语义。
 *
 * 目标状态（见 docs/问题整理/18-项目页插件面板与上下文分层.md）：
 * - 根级 Provider 常驻应用底座（save/resources/注册表/命令）；
 * - 进入画布才装 canvas-data（doc/selection/…），离开画布就卸掉；
 * - 业务插件靠 inject 决定何时启动，项目页不必启动一张画布。
 *
 * 这里锁的是内核/数据层这一半：会话是可装卸的普通插件，依赖它的插件会回退 PENDING。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '../context'
import { createCanvasAppBasePlugin } from '../canvasAppBasePlugin'
import { createCanvasDataPlugin, CANVAS_DATA_PLUGIN_NAME } from '../canvasDataPlugin'
import { MemoryStorageAdapter } from '../../storage/memoryAdapter'

describe('canvas-base + canvas-data', () => {
  it('应用底座先起：save/resources 可用，doc 还不存在', async () => {
    const ctx = new Context()
    const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(app.plugin)
    await ctx.start()

    expect(ctx.hasService('save')).toBe(true)
    expect(ctx.hasService('resources')).toBe(true)
    expect(ctx.hasService('doc')).toBe(false)
    expect(ctx.hasService('selection')).toBe(false)
    ctx.stop()
  })

  it('画布会话可装卸：装入后 doc 出现，卸载后依赖方回退 PENDING', async () => {
    const ctx = new Context()
    const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(app.plugin)
    await ctx.start()

    let applied = 0
    ctx.installPlugin({
      name: 'biz-node',
      inject: ['doc'],
      apply() {
        applied += 1
      },
    })
    expect(applied).toBe(0)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('pending')

    const session = createCanvasDataPlugin({ appBase: app.services })
    ctx.installPlugin(session.plugin)
    expect(applied).toBe(1)
    expect(ctx.hasService('doc')).toBe(true)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('active')

    // 卸载会话：doc 消失，依赖方回退 PENDING（服务恢复后会自动重来）
    expect(ctx.uninstallPlugin(CANVAS_DATA_PLUGIN_NAME)).toBe(true)
    expect(ctx.hasService('doc')).toBe(false)
    expect(ctx.inspectPlugins().find((p) => p.name === 'biz-node')?.state).toBe('pending')

    // 再进画布：重新装一个新实例，依赖方再次启动
    const again = createCanvasDataPlugin({ appBase: app.services })
    ctx.installPlugin(again.plugin)
    expect(applied).toBe(2)
    ctx.stop()
  })

  it('会话复用应用底座的同一批实例（不会出现两份 save/resources）', async () => {
    const ctx = new Context()
    const app = createCanvasAppBasePlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(app.plugin)
    await ctx.start()
    const session = createCanvasDataPlugin({ appBase: app.services })
    ctx.installPlugin(session.plugin)

    expect(session.services.save).toBe(app.services.save)
    expect(session.services.resources).toBe(app.services.resources)
    expect(session.services.themeRegistry).toBe(app.services.themeRegistry)
    expect(ctx.get('save')).toBe(app.services.save)
    ctx.stop()
  })
})
