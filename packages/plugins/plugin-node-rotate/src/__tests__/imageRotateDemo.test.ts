/**
 * 一键演示的行为契约（用户口径 2026-10-30）：
 * - 画布里**已有选中的图片节点**时，点按钮只新建 **1 个**节点，并连到那张选中的图；
 * - 新节点被选中、且进入「旋转与镜像」模式（openRotateMode + nodeToolbar.enter 两步都要）；
 * - 没有选中图片时，先补一张示例原图再连（单点击通）。
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@mini-canvas/canvas-data'
import { createRotateDemo } from '../imageRotateDemo'
import { rotateMode } from '../rotateSession'

/** 假栈：command 建节点、doc 提供节点表、selection 记录选中、nodeToolbar 记录 enter */
function fakeStack(selected: string[] = []) {
  const nodes = new Map<string, { id: string; type: string; position: { x: number; y: number }; size?: { w: number; h: number }; data: Record<string, unknown> }>()
  const entered: Array<{ nodeId: string; modeId: string }> = []
  const selectedIds = new Set(selected)
  let seq = 0

  const ctx = new Context()
  ctx.provide('command', {
    execute: (id: string, payload?: unknown) => {
      if (id !== 'command:create-node') return undefined
      const p = payload as { type: string; position: { x: number; y: number }; imageUrl?: string }
      seq += 1
      const nodeId = 'n' + seq
      nodes.set(nodeId, { id: nodeId, type: p.type, position: p.position, data: { imageUrl: p.imageUrl ?? '' } })
      return nodeId
    },
  })
  ctx.provide('doc', {
    getNodes: () => [...nodes.values()],
    transaction: (_reason: string, fn: (tx: unknown) => unknown) =>
      fn({ createNode: vi.fn(), connectEdge: vi.fn() }),
  })
  ctx.provide('selection', {
    get ids() {
      return new Set(selectedIds)
    },
    set(ids: Iterable<string>) {
      selectedIds.clear()
      for (const id of ids) selectedIds.add(id)
    },
  })
  ctx.provide('nodeToolbar', {
    enter: (nodeId: string, modeId: string) => void entered.push({ nodeId, modeId }),
  })
  return { ctx, nodes, entered, selectedIds }
}

describe('createRotateDemo（点状态栏按钮）', () => {
  it('已有选中图片 → 只新建 1 个节点，连到选中的图，并进入该新节点的旋转模式', async () => {
    const { ctx, nodes, entered, selectedIds } = fakeStack()
    // 预先放一张"用户的图"
    const existing = (ctx.get('command') as { execute(id: string, p?: unknown): unknown })
      .execute('command:create-node', { type: 'image', position: { x: 0, y: 0 }, imageUrl: 'blob:user' }) as string
    selectedIds.add(existing)
    const before = nodes.size

    const created = createRotateDemo(ctx)
    expect(typeof created).toBe('string')
    expect(nodes.size).toBe(before + 1) // 只多一个节点
    expect(created).not.toBe(existing)

    // 等 300ms 的 enter（setTimeout 兜底跨过挂载动画）
    await new Promise((r) => setTimeout(r, 400))
    expect(entered).toEqual([{ nodeId: created, modeId: 'node-rotate/mode' }])
    expect(rotateMode.value).toBe(created)
    expect([...selectedIds]).toEqual([created])
  })

  it('没有选中图片 → 先补一张示例原图，再建 1 个新节点（共 2 个）', async () => {
    const { ctx, nodes, entered } = fakeStack()
    const before = nodes.size
    const created = createRotateDemo(ctx)
    expect(typeof created).toBe('string')
    expect(nodes.size).toBe(before + 2)
    await new Promise((r) => setTimeout(r, 400))
    expect(entered.map((e) => e.nodeId)).toEqual([created])
  })
})
