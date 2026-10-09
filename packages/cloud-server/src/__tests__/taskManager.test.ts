/**
 * TaskManager 单测 —— 假 provider + 假时钟（不等真时间）。
 *
 * 锁的是「后台跑任务」这条链：下单立刻返回、进度写进节点、终态写节点并归档历史、
 * 取消会去服务端真取消（不是只停本地）、超时会收敛成失败（不留悬挂 running）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasStore } from '../store/canvasStore'
import { CanvasResourceStore } from '../store/canvasResources'
import { CanvasDocument } from '../mcp/canvasDoc'
import { ProviderRegistry } from '../providers/registry'
import { HistoryStore } from '../tasks/history'
import { TaskManager } from '../tasks/taskManager'
import type { ActionDef, Provider, ProviderPollResult } from '../providers/types'

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'tasks-'))
})
afterEach(async () => {
  // 收掉可能还在跑的任务循环（否则它会继续往临时目录写，导致清理失败）
  await tasksRef?.dispose()
  tasksRef = undefined
  await fs.rm(root, { recursive: true, force: true })
})

/** 记住当前用例的 TaskManager，便于 afterEach 收尾 */
let tasksRef: TaskManager | undefined

const ACTION: ActionDef = { id: 'p:gen', title: '测试生成', nodeTypes: ['image'], tool: 't/x' }

/** 造一个带 IHDR 的最小 PNG（宽高可读），用来验后台收产物时能量出图片尺寸 */
function pngBytes(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12)
  b[16] = (w >> 24) & 0xff; b[17] = (w >> 16) & 0xff; b[18] = (w >> 8) & 0xff; b[19] = w & 0xff
  b[20] = (h >> 24) & 0xff; b[21] = (h >> 16) & 0xff; b[22] = (h >> 8) & 0xff; b[23] = h & 0xff
  return b
}

/** 造一套依赖：真 doc（写临时目录）+ 指定行为的假 provider */
async function setup(provider: Provider, opts: { interval?: number; timeoutMs?: number; artifact?: Uint8Array; action?: ActionDef } = {}) {
  const action = opts.action ?? ACTION
  const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
  const registry = new ProviderRegistry()
  registry.add({ ...provider, actions: [action] })
  const history = new HistoryStore(root)
  let clock = 1_000_000
  const tasks = new TaskManager({
    doc,
    registry,
    history,
    resolveResourceUrl: async (canvasId, ref) => '/api/canvases/' + canvasId + '/resources/' + ref.replace('res:', ''),
    // 假取字节：测试里不去连真地址（产物地址都是编的），给一小段假 PNG 字节即可
    fetchArtifact: async () => opts.artifact ?? new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    now: () => clock,
    // 假睡眠：不动真时间，但推进假时钟（否则超时判断永远为假）
    sleep: async (ms) => {
      clock += ms
    },
  })
  registry.getAction(action.id)!.pollIntervalMs = opts.interval ?? 0
  registry.getAction(action.id)!.pollTimeoutMs = opts.timeoutMs ?? 10_000_000
  tasksRef = tasks

  // 先建一个节点（任务要往它身上写进度）
  await doc.batchNodes({ add: [{ type: 'image', id: 'n1' }] })
  return { doc, registry, history, tasks }
}

/** 等条件成立（后台任务是异步跑的） */
async function waitFor(cond: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (cond()) return true
    await new Promise((r) => setTimeout(r, 5))
  }
  return cond()
}

describe('下单', () => {
  it('视频产物 → 量出 videoWidth/videoHeight 写进视频节点（9:16 不该显示成横的）', async () => {
    const VIDEO_ACTION: ActionDef = { id: 'p:vid', title: '测试出视频', nodeTypes: ['video'], tool: 't/v' }
    // 最小 MP4：ftyp + moov>trak>tkhd（宽 1080 高 1920）
    const box = (type: string, payload: Uint8Array): Uint8Array => {
      const out = new Uint8Array(8 + payload.length)
      const size = out.length
      out[0] = (size >> 24) & 0xff; out[1] = (size >> 16) & 0xff; out[2] = (size >> 8) & 0xff; out[3] = size & 0xff
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
      out.set(payload, 8)
      return out
    }
    const put32 = (a: Uint8Array, o: number, v: number) => { a[o] = (v >>> 24) & 0xff; a[o + 1] = (v >>> 16) & 0xff; a[o + 2] = (v >>> 8) & 0xff; a[o + 3] = v & 0xff }
    const tkhdPayload = new Uint8Array(84)
    put32(tkhdPayload, 76, 1080 << 16)
    put32(tkhdPayload, 80, 1920 << 16)
    const ftypBox = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d]))
    const moovB = box('moov', box('trak', box('tkhd', tkhdPayload)))
    const mp4 = new Uint8Array(ftypBox.length + moovB.length)
    mp4.set(ftypBox, 0); mp4.set(moovB, ftypBox.length)

    const p: Provider = {
      id: 'p', actions: [VIDEO_ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['http://localhost:8033/api/resources/videos/doubao/v-clip.mp4'] } },
    }
    const { doc, tasks } = await setup(p, { artifact: mp4, action: VIDEO_ACTION })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: VIDEO_ACTION.id })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const node = (await doc.read()).nodes.find((n) => n.id === 'n1')!
    expect(node.data?.videoWidth).toBe(1080)
    expect(node.data?.videoHeight).toBe(1920)
  })

  it('任务成功 → 产物写进节点的媒体字段（同源地址），不是只写 runState.urls', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'done', urls: ['http://localhost:8033/api/resources/images/doubao/x-abc.jpeg'] } },
    }
    // 产物字节给一张 9:16 的 PNG：验后台能量出尺寸并写进节点（否则卡片停在 4:3）
    const { doc, tasks } = await setup(p, { artifact: pngBytes(1152, 2048) })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in job).toBe(false)
    await waitFor(() => tasks.getJob((job as { id: string }).id)?.status === 'done')
    const node = (await doc.read()).nodes.find((n) => n.id === 'n1')!
    // 关键：图片节点要靠 imageUrl 才显示；只写 runState.urls 会「生成了却看不到内容」。
    // 地址是**按内容哈希**存的（不是原文件名），所以只断言「同源 + 在画布资源目录下 + 扩展名对」。
    expect(String(node.data?.imageUrl)).toMatch(/^\/api\/canvases\/default\/resources\/[0-9a-f]+\.jpeg$/)
    expect((node.data?.runState as { urls?: string[] })?.urls).toHaveLength(1)
    // 文件真的落盘了（这是重点：没有它图片会显示「已失效」）
    const hashName = String(node.data?.imageUrl).split('/').pop()!
    await fs.access(path.join(root, 'canvases', 'default', 'resources', hashName))
    // 尺寸也量出来写进节点了（前端据此把卡片调成 9:16）
    expect(node.data?.imageWidth).toBe(1152)
    expect(node.data?.imageHeight).toBe(2048)
    // 历史也要存**同源地址**：前端拿它当缩略图；存 web2api 原始文件名会被资源接口判非法（400）→ 裂图
    const hist = await new HistoryStore(root).readAll('default')
    expect(hist[0]?.urls?.[0]).toBe(node.data?.imageUrl)
    const rsUrls = (node.data?.runState as { urls?: string[] } | undefined)?.urls
    expect(String(rsUrls?.[0] ?? '')).toMatch(/^\/api\/canvases\/default\/resources\//)
  })

  it('同一（画布, 节点）已有在跑任务时 → 挡下重复下单（连点保护）', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { taskId: 'pt1' } }, async poll() { return { status: 'running' } } }
    const { tasks } = await setup(p, { interval: 100000 })
    const first = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in first).toBe(false)
    // 第二次（同一个画布+节点）应被拒，而不是创建第二个任务
    const second = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in second).toBe(true)
    expect((second as { error: string }).error).toContain('已有任务在进行中')
    // 另一个节点仍然可以下单（不该误伤）
    const other = await tasks.createJob({ canvasId: 'default', nodeId: 'n2', actionId: ACTION.id })
    expect('error' in other).toBe(false)
  })

  it('多画布：进度写进**任务所属那张画布**（写错画布会表现为"进度一直卡 0"）', async () => {
    const p: Provider = {
      id: 'p', actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll(): Promise<ProviderPollResult> { return { status: 'done', urls: ['https://x/1.png'] } },
    }
    // 造两张画布：default（共享 doc）与 other（另一个 CanvasDocument）
    const defaultDoc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
    const otherDoc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root), 'other')
    const registry = new ProviderRegistry()
    registry.add({ ...p, actions: [ACTION] })
    const tasks = new TaskManager({
      doc: defaultDoc,
      docForCanvas: (id) => (id === 'other' ? otherDoc : defaultDoc),
      registry,
      history: new HistoryStore(root),
      resolveResourceUrl: async (canvasId, ref) => '/api/canvases/' + canvasId + '/resources/' + ref.replace('res:', ''),
      fetchArtifact: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    })
    tasksRef = tasks
    await defaultDoc.batchNodes({ add: [{ type: 'image', id: 'n1' }] })
    await otherDoc.batchNodes({ add: [{ type: 'image', id: 'n1' }] })

    const job = (await tasks.createJob({ canvasId: 'other', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    // other 那张画布上的节点拿到了终态；default 上同名节点**不该**被写（写错画布的症状）
    expect((await runStateOf(otherDoc, 'n1')).status).toBe('done')
    expect((await runStateOf(defaultDoc, 'n1')).status).toBeUndefined()
  })

  it('立刻返回 jobId，并把"排队中"写进节点', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { taskId: 'pt1' } }, async poll() { return { status: 'running' } } }
    const { doc, tasks } = await setup(p, { interval: 100000 })
    const job = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })
    expect('error' in job).toBe(false)
    const id = (job as { id: string }).id
    expect(id).toBeTruthy()
    const rs = await runStateOf(doc, 'n1')
    expect(rs.status).toBe('running')
    // runState.taskId 存的是 **jobId**（刷新续查 / 取消都打它）
    expect(rs.taskId).toBe(id)
  })

  it('未知动作 → 明确报错（不是静默挂着）', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { done: true } } }
    const { tasks } = await setup(p)
    const r = await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: '不存在' })
    expect('error' in r).toBe(true)
  })
})

describe('异步推进到终态', () => {
  it('进度写进节点，终态写 done + 归档一笔历史', async () => {
    let polls = 0
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll(): Promise<ProviderPollResult> {
        polls += 1
        if (polls < 3) return { status: 'running', progress: polls * 30, message: '跑了 ' + polls }
        return { status: 'done', urls: ['https://x/1.png'] }
      },
    }
    const { doc, history, tasks } = await setup(p)
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }

    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)

    // 节点上是终态（前端读的就是它）
    const rs = await runStateOf(doc, 'n1')
    expect(rs.status).toBe('done')
    // runState.urls 现在也存**同源地址**（与节点 media / 历史一致）——
    // 存 provider 原始地址的话，前端拿它当缩略图会被资源接口判非法（400）
    expect(String((rs.urls as string[] | undefined)?.[0] ?? '')).toMatch(/^\/api\/canvases\/default\/resources\/[0-9a-f]+\.png$/)

    // 历史里多了一笔（后台归档，所以 MCP 下的单也会被记上）
    const all = await history.readAll('default')
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: '测试生成', kind: 'image', status: 'done', rating: 'passed' })
    // 历史里的产物地址也换成**同源地址**（前端缩略图直接用它）
    expect(String(all[0].urls?.[0] ?? '')).toMatch(/^\/api\/canvases\/default\/resources\/[0-9a-f]+\.png$/)
  })

  it('同步完成（submit 直接给结果）也写节点 + 归档', async () => {
    const p: Provider = { id: 'p', actions: [ACTION], async submit() { return { done: true, urls: ['https://x/ok.png'] } } }
    const { doc, history, tasks } = await setup(p)
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    expect((await runStateOf(doc, 'n1')).status).toBe('done')
    expect(await history.readAll('default')).toHaveLength(1)
  })

  it('失败也收敛成 error（不留悬挂 running）+ 归档一笔失败记录', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'error', error: '平台说不行' } },
    }
    const { doc, history, tasks } = await setup(p)
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'error')).toBe(true)
    const rs = await runStateOf(doc, 'n1')
    expect(rs.status).toBe('error')
    expect(rs.message).toBe('平台说不行')
    const all = await history.readAll('default')
    expect(all[0]).toMatchObject({ status: 'error', error: '平台说不行' })
  })

  it('超时 → 收敛成失败（长任务由动作自己的 pollTimeoutMs 顶掉）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'running', progress: 10 } },
    }
    const { tasks } = await setup(p, { timeoutMs: 3000, interval: 1000 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'error')).toBe(true)
    expect(tasks.getJob(job.id)?.result?.error).toContain('超时')
  })

  /**
   * 「等外部条件」不占超时预算（用户实测的 bug，2026-10-08）。
   *
   * 现场：任务 paused 等用户在浏览器里过验证码，人处理多久不由程序决定 ——
   * 早先拿这段等待去顶 pollTimeoutMs，人还在操作就被判超时失败。
   * 现在 provider 会给这类中间态标 `waiting`，那部分时间从预算里扣掉；
   * **普通生成中的等待不在此列**（上一条用例已锁：照样超时）。
   */
  it('等待态（paused 等验证码）不占超时预算：等多久都不判超时，恢复后照样能成功', async () => {
    let polls = 0
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() {
        polls += 1
        // 前 10 拍都在「等用户过验证码」（waiting），之后成功
        if (polls <= 10) return { status: 'running', message: '等验证码', waiting: true }
        return { status: 'done', urls: ['http://x/out.png'] }
      },
    }
    // 预算只有 3s，每拍间隔 1s —— 若等待占预算，第 4 拍就该超时失败
    const { tasks } = await setup(p, { timeoutMs: 3000, interval: 1000 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    // 等到它真的跑完（成功），而不是被判超时
    expect(await waitFor(() => tasks.getJob(job.id)?.status === 'done')).toBe(true)
    expect(tasks.getJob(job.id)?.result?.ok).toBe(true)
    expect(polls).toBeGreaterThan(10)
  })

  it('节点被删了也不炸（任务还在跑，只是没地方写进度）', async () => {
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'running' } },
    }
    const { doc, tasks } = await setup(p, { interval: 10 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    await doc.batchNodes({ delete: ['n1'] })
    // 不抛错即可（进度写不进去是预期行为）
    await new Promise((r) => setTimeout(r, 60))
    expect(tasks.getJob(job.id)).toBeTruthy()
  })
})

describe('取消', () => {
  it('取消会调 provider 的 cancel（去服务端真取消，不是只停本地）', async () => {
    const cancelled: string[] = []
    const p: Provider = {
      id: 'p',
      actions: [ACTION],
      async submit() { return { taskId: 'pt1' } },
      async poll() { return { status: 'running', taskId: 'pt1' } },
      async cancel(taskId) { cancelled.push(taskId) },
    }
    const { tasks } = await setup(p, { interval: 100000 })
    const job = (await tasks.createJob({ canvasId: 'default', nodeId: 'n1', actionId: ACTION.id })) as { id: string }
    // 等第一拍轮询把 providerTaskId 记下来
    expect(await waitFor(() => tasks.getJob(job.id)?.providerTaskId === 'pt1')).toBe(true)
    await tasks.cancel(job.id)
    expect(cancelled).toEqual(['pt1'])
  })
})

/** 读某节点当前的 runState（测试里反复要用；断言的是"前端读到的那个东西"） */
async function runStateOf(doc: CanvasDocument, nodeId: string): Promise<Record<string, unknown>> {
  const node = (await doc.read()).nodes.find((n) => n.id === nodeId)
  return (node?.data?.runState ?? {}) as Record<string, unknown>
}
