import { describe, it, expect } from 'vitest'
import { MockBackend } from '../mockBackend'

describe('MockBackend：创建任务 + 查询任务（假后台契约）', () => {
  it('创建任务立即返回 taskId，首次查询是 running 0%', () => {
    let t = 0
    const backend = new MockBackend({ steps: 10, intervalMs: 100, now: () => t })
    const { taskId } = backend.createTask()
    expect(taskId).toBe('mock-1')
    const view = backend.queryTask(taskId)
    expect(view.status).toBe('running')
    expect(view.progress).toBe(0)
  })

  it('查询进度随时间递增到 100 后给出 done + 结果', () => {
    let t = 0
    const backend = new MockBackend({ steps: 10, intervalMs: 100, now: () => t })
    const { taskId } = backend.createTask()
    t = 500
    const half = backend.queryTask(taskId)
    expect(half.status).toBe('running')
    expect(half.progress).toBe(50)
    t = 1000
    const done = backend.queryTask(taskId)
    expect(done.status).toBe('done')
    expect(done.result?.ok).toBe(true)
    expect(done.result?.urls?.[0]).toContain('data:image')
  })

  it('查询不存在的任务 → 收敛成失败（不悬挂）', () => {
    const backend = new MockBackend()
    const view = backend.queryTask('nope')
    expect(view.status).toBe('done')
    expect(view.result?.ok).toBe(false)
  })
})

