import { describe, it, expect, vi } from 'vitest'
import { chunkIds, createJobsWatcher, frameOf, type RunningNodeLike } from '../jobsWatcher'
import type { ServerJob } from '../apiTypes'

function job(over: Partial<ServerJob> = {}): ServerJob {
  return {
    id: 'j1',
    canvasId: 'default',
    nodeId: 'n1',
    actionId: 'a:1',
    providerId: 'p',
    status: 'running',
    progress: 20,
    message: '跑着',
    ...over,
  }
}

function node(over: Partial<RunningNodeLike> = {}): RunningNodeLike {
  return {
    nodeId: 'n1',
    nodeType: 'image',
    taskId: 'j1',
    actionId: 'a:1',
    data: { runState: { status: 'running', taskId: 'j1', actionId: 'a:1' } },
    ...over,
  }
}

function harness(nodes: RunningNodeLike[]) {
  const runtime: Array<{ id: string; data: Record<string, unknown> }> = []
  const results: Array<{ id: string; data: Record<string, unknown> }> = []
  const calls: string[][] = []
  return {
    runtime,
    results,
    calls,
    deps: {
      listRunning: () => nodes,
      fetchJobs: async (ids: readonly string[]) => {
        calls.push([...ids])
        const out: Record<string, ServerJob | null> = {}
        for (const id of ids) out[id] = job({ id })
        return out
      },
      writeRuntime: (id: string, data: Record<string, unknown>) => runtime.push({ id, data }),
      writeResult: (id: string, data: Record<string, unknown>) => results.push({ id, data }),
    },
  }
}

describe('frameOf：后台 Job → 节点 runState', () => {
  it('running：只搬后台给的字段（不自己估数）', () => {
    expect(frameOf(job({ value: 1900, suffix: 'tokens', tail: '你好', canCancel: true }))).toEqual({
      status: 'running',
      actionId: 'a:1',
      taskId: 'j1',
      progress: 20,
      message: '跑着',
      value: 1900,
      suffix: 'tokens',
      tail: '你好',
      canCancel: true,
    })
  })

  it('done：100% + 产物', () => {
    const f = frameOf(job({ status: 'done', result: { ok: true, urls: ['x.png'] } }))
    expect(f).toMatchObject({ status: 'done', progress: 100, urls: ['x.png'] })
  })

  it('error：把原因写进 message 与 reason（卡片才有话说）', () => {
    const f = frameOf(job({ status: 'error', result: { ok: false, error: '平台说不行' } }))
    expect(f).toMatchObject({ status: 'error', message: '平台说不行', reason: '平台说不行' })
  })

  it('error 但上游没给原因：补一句能照着查的说明', () => {
    const f = frameOf(job({ status: 'error', result: { ok: false }, message: undefined }))
    expect(String(f.reason).length).toBeGreaterThan(8)
  })
})

describe('chunkIds', () => {
  it('按批切开；不足一批只给一块', () => {
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
    expect(chunkIds([], 2)).toEqual([])
  })
})

describe('jobsWatcher：一条定时器管整张画布', () => {
  it('没有在跑的节点 → 一个请求都不发', async () => {
    const h = harness([])
    await createJobsWatcher(h.deps).tick()
    expect(h.calls).toHaveLength(0)
    expect(h.runtime).toHaveLength(0)
  })

  /**
   * 这是整套改动的核心：3 个在跑的任务 → **1 个**请求，不是 3 个。
   */
  it('多个在跑的任务只发一次批量请求', async () => {
    const nodes = [
      node({ nodeId: 'n1', taskId: 'j1' }),
      node({ nodeId: 'n2', taskId: 'j2' }),
      node({ nodeId: 'n3', taskId: 'j3' }),
    ]
    const h = harness(nodes)
    await createJobsWatcher(h.deps).tick()
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0]).toEqual(['j1', 'j2', 'j3'])
  })

  it('进度写进节点（updateNodeRuntime 这一路）', async () => {
    const h = harness([node()])
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime).toHaveLength(1)
    expect(h.runtime[0]!.data.runState).toMatchObject({ status: 'running', progress: 20, taskId: 'j1' })
  })

  it('终态：写 done，并把产物补进媒体字段', async () => {
    const nodes = [node()]
    const h = harness(nodes)
    h.deps.fetchJobs = async () => ({
      j1: job({ status: 'done', result: { ok: true, urls: ['/x.png'] } }),
    })
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime[0]!.data.runState).toMatchObject({ status: 'done', progress: 100 })
    expect(h.results[0]!.data).toEqual({ imageUrl: '/x.png' })
  })

  it('后台说没这个任务 → 收敛成失败（别让卡片永远转）', async () => {
    const h = harness([node()])
    h.deps.fetchJobs = async () => ({ j1: null })
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime[0]!.data.runState).toMatchObject({ status: 'error' })
  })

  it('查失败不算终态：这一拍什么都不写，下一拍再问', async () => {
    const h = harness([node()])
    h.deps.fetchJobs = async () => {
      throw new Error('网络抖动')
    }
    const onError = vi.fn()
    await createJobsWatcher({ ...h.deps, onError }).tick()
    expect(h.runtime).toHaveLength(0)
    expect(onError).toHaveBeenCalled()
  })

  it('状态没变就不重复写盘（避免整张画布反复落盘）', async () => {
    const nodes = [
      node({
        data: {
          runState: {
            status: 'running',
            actionId: 'a:1',
            taskId: 'j1',
            progress: 20,
            message: '跑着',
          },
        },
      }),
    ]
    const h = harness(nodes)
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime).toHaveLength(0)
  })

  it('running 但没有任务号：宽限期内不写（刚提交的正常窗口）', async () => {
    const nodes = [
      node({
        taskId: '',
        data: { runState: { status: 'running', actionId: 'a:1', startedAt: Date.now() } },
      }),
    ]
    const h = harness(nodes)
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime).toHaveLength(0)
    expect(h.calls).toHaveLength(0)
  })

  it('running 但没有任务号、已经很久：收敛成失败', async () => {
    const nodes = [
      node({
        taskId: '',
        data: { runState: { status: 'running', actionId: 'a:1', startedAt: Date.now() - 10 * 60_000 } },
      }),
    ]
    const h = harness(nodes)
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime[0]!.data.runState).toMatchObject({ status: 'error' })
  })

  it('页面不可见时跳过（不白问）', async () => {
    const h = harness([node()])
    await createJobsWatcher({ ...h.deps, visible: () => false }).tick()
    expect(h.calls).toHaveLength(0)
  })

  it('超过一批就分批问', async () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node({ nodeId: 'n' + i, taskId: 'j' + i }))
    const h = harness(nodes)
    h.deps.fetchJobs = async (ids) => {
      h.calls.push([...ids])
      return Object.fromEntries(ids.map((id) => [id, job({ id })]))
    }
    await createJobsWatcher({ ...h.deps, batchSize: 2 }).tick()
    expect(h.calls.map((c) => c.length)).toEqual([2, 2, 1])
  })
})
