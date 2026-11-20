import { describe, it, expect, vi } from 'vitest'
import { chunkIds, createJobsWatcher, frameOf, resourceRefFromUrl, uiOutputTypeForName, type RunningNodeLike } from '../jobsWatcher'
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

  /**
   * 这一条只负责「把后台给的字段写下去」，不负责补别的字段：
   * 缺的字段（例如开始时间）由数据层沿用旧值（canvas-data 的 mergeNodeRunState）。
   * 所以节点上已有开始时间、而后台这一帧没给时，不该因为「少了 startedAt」就判定要写盘。
   */
  it('后台这一帧没带开始时间、节点上已有：不算有变化，不重复写盘', async () => {
    const nodes = [
      node({
        data: {
          runState: {
            status: 'running',
            actionId: 'a:1',
            taskId: 'j1',
            progress: 20,
            message: '跑着',
            startedAt: 1_700_000_000_000,
          },
        },
      }),
    ]
    const h = harness(nodes)
    await createJobsWatcher(h.deps).tick()
    expect(h.runtime).toHaveLength(0)
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

  /**
   * 用户实测 2026-11-20：节点上已有旧图（带旧 resourceId）时，SSE 断着只补 imageUrl，
   * 画面仍然按旧引用显示旧图，保存时地址还被清理删掉 —— 新图整份丢失。
   */
  it('终态：同源产物地址同时写 resourceId，并顶掉旧引用', async () => {
    const url = '/api/canvases/default/resources/181b08e5281278b6.jpeg'
    const nodes = [
      node({ data: { resourceId: 'default/9903b5c80e4f3a3d.png', runState: { status: 'running', taskId: 'j1', actionId: 'a:1' } } }),
    ]
    const h = harness(nodes)
    h.deps.fetchJobs = async () => ({ j1: job({ status: 'done', result: { ok: true, urls: [url] } }) })
    await createJobsWatcher(h.deps).tick()
    expect(h.results[0]!.data).toEqual({ imageUrl: url, resourceId: 'default/181b08e5281278b6.jpeg' })
  })

  /** 后台随结果给出的引用是权威值：地址被重写 / 走别的域名时也不该影响引用 */
  it('终态：优先采用后台给出的 result.resourceId', async () => {
    const url = '/api/canvases/default/resources/aaaa1111.png'
    const nodes = [node()]
    const h = harness(nodes)
    h.deps.fetchJobs = async () => ({
      j1: job({ status: 'done', result: { ok: true, urls: [url], resourceId: 'default/bbbb2222.png' } }),
    })
    await createJobsWatcher(h.deps).tick()
    expect(h.results[0]!.data).toEqual({ imageUrl: url, resourceId: 'default/bbbb2222.png' })
  })

  it('终态：地址与引用都已一致 → 不重复写盘', async () => {
    const url = '/api/canvases/default/resources/abc.png'
    const nodes = [
      node({
        data: {
          imageUrl: url,
          resourceId: 'default/abc.png',
          runState: { status: 'running', taskId: 'j1', actionId: 'a:1' },
        },
      }),
    ]
    const h = harness(nodes)
    h.deps.fetchJobs = async () => ({ j1: job({ status: 'done', result: { ok: true, urls: [url] } }) })
    await createJobsWatcher(h.deps).tick()
    expect(h.results).toHaveLength(0)
  })

  it('resourceRefFromUrl：只认本画布资源地址，外链不猜', () => {
    expect(resourceRefFromUrl('/api/canvases/c1/resources/abc.png')).toBe('c1/abc.png')
    expect(resourceRefFromUrl('http://x/api/canvases/c1/resources/abc.png')).toBeUndefined()
    expect(resourceRefFromUrl('/api/assets/files/abc.png')).toBeUndefined()
  })

  /**
   * 兜底这条路也要把 UI 节点的产物类型写上：只补地址不补 uiOutputType 的话，
   * 节点「有产物但右侧没有输出端口」，下游连不上。
   */
  it('UI 节点终态：同时补 uiOutputUrl / uiOutputType / resourceId', async () => {
    const url = '/api/canvases/default/resources/abc.mp4'
    const nodes = [
      node({ nodeType: 'ui', data: { runState: { status: 'running', taskId: 'j1', actionId: 'a:1' } } }),
    ]
    const h = harness(nodes)
    h.deps.fetchJobs = async () => ({ j1: job({ status: 'done', result: { ok: true, urls: [url] } }) })
    await createJobsWatcher(h.deps).tick()
    expect(h.results[0]!.data).toEqual({
      uiOutputUrl: url,
      resourceId: 'default/abc.mp4',
      uiOutputType: 'video',
    })
  })

  it('uiOutputTypeForName：与后台/节点插件同一套后缀口径', () => {
    expect(uiOutputTypeForName('a.mp4')).toBe('video')
    expect(uiOutputTypeForName('a.wav')).toBe('audio')
    expect(uiOutputTypeForName('a.md')).toBe('text')
    expect(uiOutputTypeForName('a.png')).toBe('image')
    // 认不出后缀时与节点插件同一兜底（当图片）：宁可多一个图片端口，也不要「有产物却没端口」
    expect(uiOutputTypeForName('a.bin')).toBe('image')
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
