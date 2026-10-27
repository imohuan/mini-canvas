/**
 * 外壳插槽演示插件：注册契约测试（Node 直跑，不碰 DOM）。
 *
 * 锁三件事：三类外壳槽各登记一条；抽屉页签必带 meta.panel；条目 id 都带插件前缀
 * （卸载时好认，也避免和其它插件撞 id）。
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { apply, name } from '../index'

describe('plugin-shell-slots-demo', () => {
  it('四类外壳槽各登记 occupant（同槽可多条）', async () => {
    const ctx = new Context()
    ctx.plugin({ name, apply })
    await ctx.start()

    const slots = (ctx as unknown as {
      slots: { occupants(slot: string): Array<{ id: string; component: unknown; meta?: unknown }> }
    }).slots

    expect(slots.occupants('shell.status.end')).toHaveLength(2)
    expect(slots.occupants('shell.dock.start')).toHaveLength(1)
    expect(slots.occupants('shell.dock.end')).toHaveLength(2)
    const tabs = slots.occupants('shell.drawer.tabs')
    expect(tabs).toHaveLength(1)

    // 抽屉页签必须带 meta.panel（宿主契约：缺面板会被忽略）
    const tab = tabs[0]!
    expect((tab.meta as { panel?: unknown }).panel).toBeTruthy()

    // 全部 id 带插件前缀
    const ids = [
      ...slots.occupants('shell.status.end'),
      ...slots.occupants('shell.dock.start'),
      ...slots.occupants('shell.dock.end'),
      ...tabs,
    ].map((e) => e.id)
    for (const id of ids) expect(id.startsWith('shell-slots-demo/')).toBe(true)

    ctx.stop()
  })

  it('卸载插件后所有外壳槽条目自动回收', async () => {
    const ctx = new Context()
    ctx.plugin({ name, apply })
    await ctx.start()

    const slots = (ctx as unknown as {
      slots: { occupants(slot: string): unknown[]; remove(slot: string, id: string): boolean }
    }).slots

    ctx.uninstallPlugin('shell-slots-demo')

    expect(slots.occupants('shell.status.end')).toHaveLength(0)
    expect(slots.occupants('shell.dock.end')).toHaveLength(0)
    expect(slots.occupants('shell.drawer.tabs')).toHaveLength(0)
  })
})
