/**
 * GET /api/jobs?ids=a,b,c —— 前端那条唯一的全局定时器用。
 *
 * 锁三件事：
 * 1. 一次问一批，返回「id → Job | null」；
 * 2. 查不到的给 null，不整批 404（一个陈旧号不该拖累其它在跑的任务）；
 * 3. 路由不能被 `/api/jobs/:jobId` 抢先吃掉。
 */
import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { jobsRoutes } from '../routes/jobs'
import type { Job } from '../tasks/types'

function fakeTasks(jobs: Record<string, Job>) {
  return {
    getJob: (id: string) => jobs[id],
    createJob: async () => ({ error: '不测下单' }),
    cancel: async () => false,
    findJobByNode: () => undefined,
  } as never
}

function job(id: string): Job {
  return {
    id,
    canvasId: 'default',
    nodeId: 'n1',
    actionId: 'a:1',
    providerId: 'p',
    status: 'running',
    createdAt: 1,
    canCancel: true,
  }
}

describe('GET /api/jobs?ids=', () => {
  it('一次返回一批；查不到的给 null', async () => {
    const app = new Hono()
    app.route('/', jobsRoutes(fakeTasks({ j1: job('j1'), j2: job('j2') })))
    const body = (await (await app.request('/api/jobs?ids=j1,j2,gone')).json()) as {
      ok: boolean
      jobs: Record<string, Job | null>
    }
    expect(body.ok).toBe(true)
    expect(body.jobs.j1).toMatchObject({ id: 'j1', status: 'running' })
    expect(body.jobs.j2).toMatchObject({ id: 'j2' })
    expect(body.jobs.gone).toBeNull()
  })

  it('没有 ids → 400（而不是把 /api/jobs 当成一个任务号去查）', async () => {
    const app = new Hono()
    app.route('/', jobsRoutes(fakeTasks({})))
    const res = await app.request('/api/jobs')
    expect(res.status).toBe(400)
  })

  it('一条 IDs 太多 → 400（保护后厨）', async () => {
    const app = new Hono()
    app.route('/', jobsRoutes(fakeTasks({})))
    const ids = Array.from({ length: 201 }, (_, i) => 'j' + i).join(',')
    const res = await app.request('/api/jobs?ids=' + ids)
    expect(res.status).toBe(400)
  })

  it('/api/jobs/:jobId 仍然照常工作（批量那条没把它吃掉）', async () => {
    const app = new Hono()
    app.route('/', jobsRoutes(fakeTasks({ j1: job('j1') })))
    const body = (await (await app.request('/api/jobs/j1')).json()) as { ok: boolean; job: Job }
    expect(body.ok).toBe(true)
    expect(body.job.id).toBe('j1')
  })
})
