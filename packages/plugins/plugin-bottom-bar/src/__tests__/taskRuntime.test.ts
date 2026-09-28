import { describe, it, expect, vi } from 'vitest'
import { runAction, resumeAction } from '../taskRuntime'
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
    interval: 1,
    timeoutMs: 5000,
    throttleMs: 0, // 测试关掉节流，逐帧可断言
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

describe('runAction', () => {
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

  it('异步动作：轮询被驱动到 done，逐帧写 runtime（throttleMs=0）', async () => {
    let step = 0
    const action = imageAction({
      run: () => () => {
        step += 1
        return step < 3
          ? { status: 'running', progress: step * 30, message: '跑着呢' }
          : { status: 'done', result: { ok: true, urls: ['y.png'] } }
      },
    })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]) },
      h.deps,
    )
    expect(out.ok).toBe(true)
    expect(h.runtime.filter((s) => s.status === 'running').length).toBeGreaterThanOrEqual(3)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('中间帧节流：窗口内不写（不论进度是否变），终态不受节流影响', async () => {
    let step = 0
    const action = imageAction({
      run: () => () => {
        step += 1
        return step < 4
          ? { status: 'running', progress: step * 10, message: '跑着呢' }
          : { status: 'done', result: { ok: true, urls: ['z.png'] } }
      },
    })
    const h = harness()
    h.deps.throttleMs = 10_000
    await runAction({ nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]) }, h.deps)
    expect(h.runtime.filter((s) => s.status === 'running')).toHaveLength(1) // 只剩提交那一帧
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
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
    const action = imageAction({ id: 'image.rotate', apply: 'self', run: () => ({ ok: true }) })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action], { image: applied }) },
      h.deps,
    )
    expect(out.ok).toBe(true)
    expect(applied).not.toHaveBeenCalled()
    expect(h.written).toHaveLength(0)
  })

  it('取消：signal 已中止时收敛成 error', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    const action = imageAction({ run: () => new Promise(() => {}) as never })
    const h = harness()
    const out = await runAction(
      { nodeId: 'n1', nodeType: 'image', action, input: {}, registry: registryOf([action]), signal: ctrl.signal },
      h.deps,
    )
    expect(out.ok).toBe(false)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
  })
})

describe('resumeAction：刷新后接着查', () => {
  it('动作有 resume 且有 taskId → 续查到终态', async () => {
    let step = 0
    const action = imageAction({
      resume: () => () => {
        step += 1
        return step < 2
          ? { status: 'running', progress: 60 }
          : { status: 'done', result: { ok: true, urls: ['r.png'] } }
      },
    })
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([action]), taskId: 't1', actionId: 'a' },
      h.deps,
    )
    expect(out.resumed).toBe(true)
    expect(h.runtime.at(-1)).toMatchObject({ status: 'done' })
  })

  it('动作没声明 resume → 标中断错误，不悬挂', async () => {
    const action = imageAction()
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([action]), taskId: 't1', actionId: 'a' },
      h.deps,
    )
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
  })

  it('拿不到 taskId → 标中断错误', async () => {
    const action = imageAction({ resume: () => () => ({ status: 'running' }) })
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([action]), taskId: '', actionId: 'a' },
      h.deps,
    )
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
  })

  it('动作本身已不存在 → 标中断错误，不抛', async () => {
    const h = harness()
    const out = await resumeAction(
      { nodeId: 'n1', nodeType: 'image', registry: registryOf([]), taskId: 't1', actionId: 'gone.action' },
      h.deps,
    )
    expect(out.resumed).toBe(false)
    expect(out.state.status).toBe('error')
    expect(h.runtime.at(-1)).toMatchObject({ status: 'error' })
  })
})

