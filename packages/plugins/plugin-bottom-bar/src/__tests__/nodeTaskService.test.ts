import { describe, expect, it, vi } from 'vitest'
import { Context } from '@mini-canvas/kernel'
import type { BarAction } from '../barTypes'
import { NodeBarService, NodeTaskService, registerBarAction } from '../nodeBarPlugin'

/**
 * NodeTaskService 的新形状（用户口径 2026-11-10）。
 *
 * 任务只有后台在跑：这里不再保存 AbortController、不再自己轮询、也不再「刷新续查」。
 * 它只剩两件事 —— 提交（写 running 帧 + 调动作的 run），取消（按节点上的 taskId 请后台停）。
 */

function makeDoc(initial: Record<string, unknown> = {}) {
  const store: Record<string, { id: string; type: string; data: Record<string, unknown> }> = {
    n1: { id: 'n1', type: 'image', data: { ...initial } },
  }
  const writes: Array<Record<string, unknown>> = []
  const doc = {
    getNode: (id: string) => store[id],
    getNodes: () => Object.values(store),
    updateNodeRuntime: (id: string, patch: { data?: Record<string, unknown> }) => {
      if (!store[id] || !patch.data) return
      if (patch.data.runState) {
        store[id].data = { ...store[id].data, runState: patch.data.runState }
        writes.push(patch.data.runState as Record<string, unknown>)
      }
    },
    updateNode: () => {},
  }
  return { doc, writes, store }
}

function makeCtx(doc: unknown, action: BarAction) {
  const ctx = new Context()
  ctx.inject('doc', doc)
  ctx.plugin({
    name: 'bar-host',
    apply(c) {
      new NodeBarService(c as never)
      registerBarAction(c as never, action)
    },
  })
  return ctx
}

/** 永不自己结束、只由 onCancel 收尾的生成类动作（返回轮询函数） */
const GENERATING: BarAction = {
  id: 'gen',
  types: ['image'],
  title: '慢慢跑',
  run: () => async () => ({ status: 'running' as const }),
  onCancel: () => {},
}

describe('NodeTaskService.run：只提交，不等结果', () => {
  it('写一帧 running（带 canCancel），立刻返回', async () => {
    const { doc, writes } = makeDoc()
    const ctx = makeCtx(doc, GENERATING)
    await ctx.start()
    const task = new NodeTaskService(ctx as never)
    const out = await task.run('n1', 'gen', {})
    expect(out.ok).toBe(true)
    expect(writes[0]).toMatchObject({ status: 'running', actionId: 'gen', canCancel: true })
    ctx.stop()
  })

  it('没有 onCancel 的动作：提交帧写 canCancel:false（不给假按钮）', async () => {
    const { doc, writes } = makeDoc()
    const plain: BarAction = { id: 'plain', types: ['image'], title: '普通', run: () => async () => ({ status: 'running' as const }) }
    const ctx = makeCtx(doc, plain)
    await ctx.start()
    await new NodeTaskService(ctx as never).run('n1', 'plain', {})
    expect(writes[0]).toMatchObject({ canCancel: false })
    ctx.stop()
  })

  it('动作不存在：直接给一句错误，不抛', async () => {
    const { doc } = makeDoc()
    const ctx = makeCtx(doc, GENERATING)
    await ctx.start()
    const out = await new NodeTaskService(ctx as never).run('n1', 'gone', {})
    expect(out.ok).toBe(false)
    ctx.stop()
  })
})

describe('NodeTaskService.cancel：按节点上的 taskId 请后台停', () => {
  it('拿 runState.taskId 调动作的 onCancel，并立刻写「已取消」', async () => {
    const { doc, writes } = makeDoc({
      runState: { status: 'running', actionId: 'gen', taskId: 'j7', canCancel: true },
    })
    const cancelFn = vi.fn()
    const action: BarAction = { ...GENERATING, onCancel: cancelFn }
    const ctx = makeCtx(doc, action)
    await ctx.start()
    const ok = await new NodeTaskService(ctx as never).cancel('n1')
    expect(ok).toBe(true)
    expect(cancelFn).toHaveBeenCalledWith('j7', expect.anything())
    expect(writes.at(-1)).toMatchObject({ status: 'error', message: '已取消' })
    ctx.stop()
  })

  it('节点上没有 taskId：什么都不做，返回 false', async () => {
    const { doc } = makeDoc({ runState: { status: 'running', actionId: 'gen' } })
    const cancelFn = vi.fn()
    const ctx = makeCtx(doc, { ...GENERATING, onCancel: cancelFn })
    await ctx.start()
    const ok = await new NodeTaskService(ctx as never).cancel('n1')
    expect(ok).toBe(false)
    expect(cancelFn).not.toHaveBeenCalled()
    ctx.stop()
  })

  it('动作没声明 onCancel：返回 false（没有可取消的通道）', async () => {
    const { doc } = makeDoc({ runState: { status: 'running', actionId: 'plain', taskId: 'j7' } })
    const ctx = makeCtx(doc, { id: 'plain', types: ['image'], title: '普通', run: () => ({ ok: true }) })
    await ctx.start()
    expect(await new NodeTaskService(ctx as never).cancel('n1')).toBe(false)
    ctx.stop()
  })

  it('后台取消失败不改变「本地已取消」的事实', async () => {
    const { doc, writes } = makeDoc({
      runState: { status: 'running', actionId: 'gen', taskId: 'j7' },
    })
    const action: BarAction = {
      ...GENERATING,
      onCancel: () => {
        throw new Error('后台 500')
      },
    }
    const ctx = makeCtx(doc, action)
    await ctx.start()
    expect(await new NodeTaskService(ctx as never).cancel('n1')).toBe(true)
    expect(writes.at(-1)).toMatchObject({ status: 'error', message: '已取消' })
    ctx.stop()
  })
})

describe('NodeTaskService.canCancel：只看节点数据', () => {
  it('runState.canCancel=true → 能取消', async () => {
    const { doc } = makeDoc({ runState: { status: 'running', actionId: 'gen', taskId: 'j1', canCancel: true } })
    const ctx = makeCtx(doc, GENERATING)
    await ctx.start()
    expect(new NodeTaskService(ctx as never).canCancel('n1')).toBe(true)
    ctx.stop()
  })

  it('runState.canCancel=false → 不画按钮（哪怕动作声明了 onCancel）', async () => {
    const { doc } = makeDoc({ runState: { status: 'running', actionId: 'gen', taskId: 'j1', canCancel: false } })
    const ctx = makeCtx(doc, GENERATING)
    await ctx.start()
    expect(new NodeTaskService(ctx as never).canCancel('n1')).toBe(false)
    ctx.stop()
  })

  it('老数据没有这个字段 → 回落到动作声明（旧行为不变）', async () => {
    const { doc } = makeDoc({ runState: { status: 'running', actionId: 'gen', taskId: 'j1' } })
    const ctx = makeCtx(doc, GENERATING)
    await ctx.start()
    expect(new NodeTaskService(ctx as never).canCancel('n1')).toBe(true)
    ctx.stop()
  })

  it('没在跑：「能不能取消」一律 false', async () => {
    const { doc } = makeDoc({ runState: { status: 'done', actionId: 'gen', canCancel: true } })
    const ctx = makeCtx(doc, GENERATING)
    await ctx.start()
    expect(new NodeTaskService(ctx as never).canCancel('n1')).toBe(false)
    ctx.stop()
  })
})
