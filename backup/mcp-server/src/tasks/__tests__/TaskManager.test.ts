import { describe, it, expect, beforeEach } from 'vitest'
import { TaskManager } from '../TaskManager'
import { GraphModel } from '../../graph/GraphModel'
import { ModelRegistry } from '../../models/ModelRegistry'
import type { ModelRunner, GenerationPayload } from '../../models/types'

/** 一个 image 模型能力声明，供测试注册 */
const TEST_CAPS = [
  { model: 'test-img', label: '测试图', kind: 'image' as const, mcpTool: 'x', ratio: ['1:1'] },
]

/** 异步 mock runner：返回 PollFn，两步 running 后 done */
function makeAsyncRunner(): ModelRunner {
  let i = 0
  return {
    run: () => {
      return async () => {
        if (i === 0) { i++; return { status: 'running' as const, progress: 30, message: '采样中' } }
        if (i === 1) { i++; return { status: 'running' as const, progress: 70, message: '合成中' } }
        return { status: 'done' as const, result: { ok: true as const, urls: ['http://x/img1.png'], taskId: 'w1' } }
      }
    },
  }
}

/** 同步 mock runner：直接返回 done */
const syncRunner: ModelRunner = {
  run: () => ({ ok: true as const, urls: ['http://x/sync.png'] }),
}

/** 失败 runner */
const failRunner: ModelRunner = {
  run: () => ({ ok: false as const, error: '模拟生成失败' }),
}

function registryWith(runner: ModelRunner): ModelRegistry {
  const reg = new ModelRegistry()
  reg.registerCapabilities([...TEST_CAPS])
  reg.registerRunner('web2api', runner)
  return reg
}

const makePayload = (model = 'test-img'): GenerationPayload => ({ model, promptText: 'a cat', resources: [] })

describe('TaskManager（registry + PollFn 统一驱动）', () => {
  let model: GraphModel
  let manager: TaskManager

  beforeEach(() => {
    model = new GraphModel()
    model.createCanvas('t1')
  })

  it('创建任务立即返回 task_id 且状态 pending，节点 runState 置 running', () => {
    manager = new TaskManager(model, { registry: registryWith(syncRunner) })
    const node = model.createNode('t1', { type: 'image' })
    const task = manager.createTask('image', 't1', node.id, makePayload())
    expect(task.id).toBeTruthy()
    expect(task.status).toBe('pending')
    const rs = model.getNode('t1', node.id)!.data.runState as any
    expect(rs.status).toBe('running')
    expect(rs.taskId).toBe(task.id)
  })

  it('同步 runner：完成后回写节点 runState done/urls', async () => {
    manager = new TaskManager(model, { registry: registryWith(syncRunner) })
    const node = model.createNode('t1', { type: 'image' })
    manager.createTask('image', 't1', node.id, makePayload())
    await new Promise((r) => setTimeout(r, 30))
    const rs = model.getNode('t1', node.id)!.data.runState as any
    expect(rs.status).toBe('done')
    expect(rs.urls).toEqual(['http://x/sync.png'])
  })

  it('异步 PollFn runner：进度逐段回写 running，最终 done', async () => {
    manager = new TaskManager(model, { registry: registryWith(makeAsyncRunner()), interval: 5 })
    const node = model.createNode('t1', { type: 'image' })
    manager.createTask('image', 't1', node.id, makePayload())
    await new Promise((r) => setTimeout(r, 60))
    const rs = model.getNode('t1', node.id)!.data.runState as any
    expect(rs.status).toBe('done')
    expect(rs.urls).toEqual(['http://x/img1.png'])
  })

  it('失败 runner：节点 runState 置 error', async () => {
    manager = new TaskManager(model, { registry: registryWith(failRunner) })
    const node = model.createNode('t1', { type: 'image' })
    manager.createTask('image', 't1', node.id, makePayload())
    await new Promise((r) => setTimeout(r, 30))
    const rs = model.getNode('t1', node.id)!.data.runState as any
    expect(rs.status).toBe('error')
    expect(rs.message).toContain('模拟生成失败')
  })

  it('findTaskByNode：按目标节点 id 反查任务', () => {
    manager = new TaskManager(model, { registry: registryWith(syncRunner) })
    const node = model.createNode('t1', { type: 'image' })
    const task = manager.createTask('image', 't1', node.id, makePayload())
    const found = manager.findTaskByNode('t1', node.id)
    expect(found?.id).toBe(task.id)
  })
})
