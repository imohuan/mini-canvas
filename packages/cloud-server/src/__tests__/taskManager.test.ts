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

/** 造一套依赖：真 doc（写临时目录）+ 指定行为的假 provider */
async function setup(provider: Provider, opts: { interval?: number; timeoutMs?: number } = {}) {
  const doc = new CanvasDocument(new CanvasStore(root), new CanvasResourceStore(root))
  const registry = new ProviderRegistry()
  registry.add({ ...provider, actions: [ACTION] })
  const history = new HistoryStore(root)
  let clock = 1_000_000
  const tasks = new TaskManager({
    doc,
    registry,
    history,
    resolveResourceUrl: (canvasId, ref) => '/api/canvases/' + canvasId + '/resources/' + ref.replace('res:', ''),
    now: () => clock,
    // 假睡眠：不动真时间，但推进假时钟（否则超时判断永远为假）
    sleep: async (ms) => {
      clock += ms
    },
  })
  registry.getAction(ACTION.id)!.pollIntervalMs = opts.interval ?? 0
  registry.getAction(ACTION.id)!.pollTimeoutMs = opts.timeoutMs ?? 10_000_000
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
    expect(rs.urls).toEqual(['https://x/1.png'])

    // 历史里多了一笔（后台归档，所以 MCP 下的单也会被记上）
    const all = await history.readAll('default')
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ title: '测试生成', kind: 'image', status: 'done', rating: 'passed' })
    expect(all[0].urls).toEqual(['https://x/1.png'])
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
