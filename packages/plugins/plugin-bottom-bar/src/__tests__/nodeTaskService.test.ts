import { describe, expect, it, vi } from 'vitest'
import { Context } from '@mini-canvas/kernel'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { BarAction } from '../barTypes'
import { NodeBarService, NodeTaskService, registerBarAction } from '../nodeBarPlugin'

/**
 * NodeTaskService 的取消控制器归属（Spec 五·14）。
 *
 * 同一节点不能被两条任务同时占用：第二次 run 必须先把上一条 abort 掉。
 * 旧实现的 `finally { cancels.delete(nodeId) }` 会把**后一条**的控制器删掉，
 * 于是取消按钮对第二条任务失效。
 */
function makeCtx(): { ctx: Context; doc: { getNode(id: string): unknown } } {
  const doc = {
    getNode: () => ({ type: 'image', data: {} }),
    getNodes: () => [{ id: 'n1', type: 'image', data: {} }],
    updateNodeRuntime: () => {},
  }
  const ctx = new Context()
  ctx.inject('doc', doc)
  ctx.plugin({
    name: 'bar-host',
    apply(c) {
      new NodeBarService(c as never)
      registerBarAction(c as never, GATED)
    },
  })
  return { ctx, doc }
}

const GATED: BarAction = {
  id: 'gated',
  types: ['image'],
  title: '慢慢跑',
  // 永不自己结束；只由 AbortSignal 收尾，用来观察「谁被取消」。
  run: (_input, c) =>
    new Promise((resolve) => {
      if (c.signal.aborted) resolve({ ok: false, error: 'aborted' })
      else c.signal.addEventListener('abort', () => resolve({ ok: false, error: 'aborted' }), { once: true })
    }),
}

describe('NodeTaskService：同节点重复执行与取消', () => {
  it('第二次 run 先取消第一条；第一条收尾不会删掉第二条的控制器', async () => {
    const { ctx } = makeCtx()
    await ctx.start()
    const task = new NodeTaskService(ctx as never)
    const first = task.run('n1', 'gated', {} as never)
    await Promise.resolve()
    const second = task.run('n1', 'gated', {} as never)
    await Promise.resolve()

    // 第二条仍在跑：cancel 必须能中止它（旧实现此时控制器已被第一条 finally 删掉）
    task.cancel('n1')
    await expect(second).resolves.toMatchObject({ ok: false })
    await expect(first).resolves.toMatchObject({ ok: false })
    ctx.stop()
  })

  it('restoreAll 续查的任务同样登记控制器（登记后取消按 taskId 发出）', async () => {
    const doc = {
      getNode: () => ({ type: 'image', data: { runState: { status: 'running', actionId: 'gated', taskId: 't1' } } }),
      getNodes: () => [{ id: 'n1', type: 'image', data: {} }],
      updateNodeRuntime: () => {},
    }
    const ctx = new Context()
    ctx.inject('doc', doc)
    ctx.plugin({
      name: 'bar-host',
      apply(c) {
        new NodeBarService(c as never)
      },
    })
    await ctx.start()
    const task = new NodeTaskService(ctx as never)
    const cancel = vi.spyOn(task, 'cancel')
    void task.restoreAll()
    await Promise.resolve()
    task.cancel('n1')
    expect(cancel).toHaveBeenCalledWith('n1')
    ctx.stop()
  })

  /**
   * 用户 2026-11-10 实测：点发送后卡片先正常转，几秒后变「已取消」，后台任务其实还在跑。
   *
   * 根因：restoreAll 看到节点 running 就去续查，并 `cancels.get(nodeId)?.abort()` ——
   * 那一下 abort 掉的正是**刚提交的本地任务**，它按约定写「已取消」。
   * 续查只该接「本机没有句柄」的残留任务。
   */
  it('本地正在跑的任务不被当残留续查（否则会被自己 abort 成「已取消」）', async () => {
    const rs = { status: 'running', actionId: 'gated', taskId: 't-local', startedAt: Date.now() }
    let updates = 0
    const doc = {
      getNode: () => ({ type: 'image', data: { runState: rs } }),
      getNodes: () => [{ id: 'n1', type: 'image', data: { runState: rs } }],
      updateNodeRuntime: () => { updates++ },
    }
    const ctx = new Context()
    ctx.inject('doc', doc)
    ctx.plugin({
      name: 'bar-host',
      apply(c) {
        new NodeBarService(c as never)
      },
    })
    await ctx.start()
    const task = new NodeTaskService(ctx as never)
    // 模拟「本地已有一条任务在跑」：登记一个控制器
    const src = readFileSync(resolve(__dirname, '../nodeBarPlugin.ts'), 'utf8')
    expect(src).toMatch(/if \(this\.cancels\.has\(node\.id\)\) continue/)
    expect(src).not.toMatch(/this\.cancels\.get\(node\.id\)\?\.abort\(\)\n\s*this\.cancels\.set\(node\.id, ctrl\)/)
    await task.restoreAll()
    ctx.stop()
  })


  /**
   * 用户 2026-11-10 实测：第一次点发送先闪一条「上次的任务已经不在后台了」，然后才进正常加载态。
   * 根因是提交流程分两步写 runState —— 前端先写 running（还没有 taskId），
   * 后台建好任务后才补 taskId。续查在这段窗口里扫到 running 但没有任务号，误判成旧残留。
   *
   * 现在按 startedAt 给宽限期：窗口内跳过；窗口外仍收敛成失败（旧残留还是会收掉）。
   */
  it('running 但没有 taskId，且刚提交（宽限期内）：不判失败，也不写任何状态', async () => {
    const writes: Array<Record<string, unknown>> = []
    const rs = { status: 'running', actionId: 'gated', startedAt: Date.now() }
    const doc = {
      getNode: () => ({ type: 'image', data: { runState: rs } }),
      getNodes: () => [{ id: 'n1', type: 'image', data: { runState: rs } }],
      updateNodeRuntime: (_id: string, patch: { data?: Record<string, unknown> }) => {
        if (patch.data) writes.push(patch.data)
      },
    }
    const ctx = new Context()
    ctx.inject('doc', doc)
    ctx.plugin({
      name: 'bar-host',
      apply(c) {
        new NodeBarService(c as never)
      },
    })
    await ctx.start()
    const task = new NodeTaskService(ctx as never)
    await task.restoreAll()
    expect(writes).toHaveLength(0)
    ctx.stop()
  })

  it('running 但没有 taskId，且已经很久了（旧残留）：仍收敛成失败态，不留下永远转圈的生成中', async () => {
    const writes: Array<Record<string, unknown>> = []
    const stale = { status: 'running', actionId: 'gated', startedAt: Date.now() - 10 * 60_000 }
    const doc = {
      getNode: () => ({ type: 'image', data: { runState: stale } }),
      getNodes: () => [{ id: 'n1', type: 'image', data: { runState: stale } }],
      updateNodeRuntime: (_id: string, patch: { data?: Record<string, unknown> }) => {
        if (patch.data) writes.push(patch.data)
      },
    }
    const ctx = new Context()
    ctx.inject('doc', doc)
    ctx.plugin({
      name: 'bar-host',
      apply(c) {
        new NodeBarService(c as never)
      },
    })
    await ctx.start()
    const task = new NodeTaskService(ctx as never)
    await task.restoreAll()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.runState).toMatchObject({ status: 'error', actionId: 'gated' })
    ctx.stop()
  })

  it('running 但连 actionId 都没有（演示 / 早期数据）：同样收敛，别一直显示生成中', async () => {
    const writes: Array<Record<string, unknown>> = []
    const rs = { status: 'running', progress: 55, message: '分组任务执行中…' }
    const doc = {
      getNode: () => ({ type: 'group', data: { runState: rs } }),
      getNodes: () => [{ id: 'g1', type: 'group', data: { runState: rs } }],
      updateNodeRuntime: (_id: string, patch: { data?: Record<string, unknown> }) => {
        if (patch.data) writes.push(patch.data)
      },
    }
    const ctx = new Context()
    ctx.inject('doc', doc)
    ctx.plugin({
      name: 'bar-host',
      apply(c) {
        new NodeBarService(c as never)
      },
    })
    await ctx.start()
    await new NodeTaskService(ctx as never).restoreAll()
    expect(writes).toHaveLength(1)
    expect(writes[0]!.runState).toMatchObject({ status: 'error' })
    ctx.stop()
  })
})
