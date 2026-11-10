import { describe, it, expect, vi } from 'vitest'
import { runAction } from '../taskRuntime'
import type { BarAction } from '../barTypes'

/** 只读查找口：动作表 + 写入器表（贴近 Task 4 用 NodeBarService 装配的形状） */
function registryOf(actions: BarAction[], appliers: Record<string, (id: string, r: never) => void> = {}) {
  const map = new Map(actions.map((a) => [a.id, a]))
  return {
    get: (id: string) => map.get(id),
    applierOf: (k: string) => appliers[k] as never,
  }
}

function harness() {
  const runtime: Record<string, unknown>[] = []
  const written: Record<string, unknown>[] = []
  const deps = {
    readData: () => ({}),
    writeRuntime: (_id: string, data: Record<string, unknown>) => {
      runtime.push(data.runState as Record<string, unknown>)
    },
    writeResult: (_id: string, data: Record<string, unknown>) => {
      written.push(data)
    },
  }
  return { runtime, written, deps }
}

const imageAction = (extra: Partial<BarAction> = {}): BarAction => ({
  id: 'a',
  types: ['image'],
  title: 'A',
  run: () => ({ ok: true, urls: ['x.png'] }),
  ...extra,
})

describe('runAction：只负责提交（任务由后台跑）', () => {
  it('同步动作：先写 running、再写 done，最后交给写入器', async () => {
    const seen: unknown[] = []
    const action = imageAction()
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: (id, r) => seen.push(r) }) },
      h.deps,
    )
    expect(out).toEqual({ ok: true, urls: ['x.png'] })
    expect(h.runtime[0]).toMatchObject({ status: 'running', actionId: 'a' })
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done', actionId: 'a' })
    expect(seen).toEqual([{ ok: true, urls: ['x.png'] }])
  })

  /**
   * 用户口径 2026-11-10：生成类动作交出去之后，**前端不再自己轮询**。
   * 提交这一步立刻返回，进度与终态交给后台 + 那一条全局定时器。
   */
  it('异步动作（返回轮询函数）：提交完立刻返回，不驱动轮询', async () => {
    const poll = vi.fn()
    const action = imageAction({ run: () => poll })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]) },
      h.deps,
    )
    expect(out.ok).toBe(true)
    expect(poll).not.toHaveBeenCalled()
    // 只写了提交那一帧
    expect(h.runtime).toHaveLength(1)
    expect(h.runtime[0]).toMatchObject({ status: 'running' })
  })

  it('提交帧就带上 canCancel（节点壳据此画按钮）', async () => {
    const withCancel = imageAction({ id: 'c', run: () => ({ ok: true }), onCancel: () => {} })
    const h1 = harness()
    await runAction({ nodeId: 'n1', nodeType: 'image', action: withCancel, input: {}, registry: registryOf([withCancel]) }, h1.deps)
    expect(h1.runtime[0]).toMatchObject({ canCancel: true })

    const noCancel = imageAction({ id: 'd', run: () => ({ ok: true }) })
    const h2 = harness()
    await runAction({ nodeId: 'n1', nodeType: 'image', action: noCancel, input: {}, registry: registryOf([noCancel]) }, h2.deps)
    expect(h2.runtime[0]).toMatchObject({ canCancel: false })
  })

  /**
   * 云端动作（externalRunState）提交后返回的是「后台任务号」，**不是最终结果**。
   * 写成 done 的话卡片会立刻显示完成，后台其实还在跑（用户实机最容易被这个骗到）。
   */
  it('已交给后台（externalRunState + taskId）：保持 running 并记下任务号，不写 done', async () => {
    const action = imageAction({
      externalRunState: true,
      onCancel: () => {},
      run: () => ({ ok: true, taskId: 'job-1' }),
    })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]) },
      h.deps,
    )
    expect(out).toEqual({ ok: true, taskId: 'job-1' })
    expect(h.runtime.at(-1)).toMatchObject({ status: 'running', taskId: 'job-1', canCancel: true })
    expect(h.runtime.some((s) => s.status === 'done')).toBe(false)
  })
  it('失败：写 error 终态，不调写入器', async () => {
    const applied = vi.fn()
    const action = imageAction({
      run: () => {
        throw new Error('后端挂了')
      },
    })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: applied }) },
      h.deps,
    )
    expect(out.ok).toBe(false)
    expect(out.error).toContain('后端挂了')
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
    expect(applied).not.toHaveBeenCalled()
  })

  it("apply:'self' 的即时动作：不经过写入器", async () => {
    const applied = vi.fn()
    const action = imageAction({ id: 'image:rotate', apply: 'self', run: () => ({ ok: true }) })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: applied }) },
      h.deps,
    )
    expect(out.ok).toBe(true)
    expect(applied).not.toHaveBeenCalled()
    expect(h.written).toHaveLength(0)
  })

})
