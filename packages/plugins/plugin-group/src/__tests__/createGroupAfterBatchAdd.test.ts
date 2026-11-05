/**
 * 「建一批图片，再在同一个事务里打组」——宫格插件「发送到画布」的真实时序。
 *
 * 用户实测 2026-11-05：宫格发布后点自动布局，分组是个空框、图片全散在外面。
 * 这里用真实内核 + 真实分组服务 + 真实 ViewService 复刻那条调用顺序，
 * 锁定「新建节点在打组这一刻必须已经能被布局服务读到」。
 */
import { describe, it, expect } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { createCanvasBasePlugin, MemoryStorageAdapter } from '@mini-canvas/canvas-data'
import { ViewService } from '@mini-canvas/canvas-render'
import { groupPlugin } from '../groupPlugin'

describe('批量建节点后在同一事务内打组', () => {
  it('每张新图片都挂到新建的分组上', async () => {
    const ctx = new Context()
    const base = createCanvasBasePlugin({ adapter: new MemoryStorageAdapter() })
    ctx.plugin(base.plugin)
    const store = base.services.nodeStore
    store.registerType({ type: 'image', label: '图片', defaultSize: { w: 320, h: 240 } })
    // 分组服务注入 view 是启动期解析的：与 groupPlugin.test.ts 同一条顺序（先给服务再起）。
    ctx.inject('view', new ViewService({ nodeStore: store }))
    ctx.plugin(groupPlugin)
    await ctx.start()

    const doc = ctx.get<{
      transaction<T>(reason: string, fn: (tx: unknown) => T): T
      getNode(id: string): { parentId?: string } | undefined
      updateNode(id: string, patch: Record<string, unknown>): void
    }>('doc')
    const group = ctx.get<{ createGroup(ids: string[]): string | null }>('group')

    const ids: string[] = []
    const groupId = doc.transaction('grid-split-publish', () => {
      for (let i = 0; i < 4; i++) {
        const id = store.addNode('image', { x: i * 340, y: 0 })
        // 发布流程建完每张图后会显式写尺寸（与 uniformGridPositions 用同一份值）
        doc.updateNode(id, { size: { w: 320, h: 240 } })
        ids.push(id)
      }
      return group.createGroup(ids)
    })

    expect(groupId).toBeTruthy()
    for (const id of ids) expect(doc.getNode(id)?.parentId).toBe(groupId)
  })
})
