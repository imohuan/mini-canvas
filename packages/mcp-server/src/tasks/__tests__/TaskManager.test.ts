import { describe, it, expect, beforeEach } from 'vitest'
import { TaskManager, type TaskRunner, type TaskRecord } from '../TaskManager'
import { GraphModel } from '../../graph/GraphModel'

/** 快速 runner：几乎立即完成 */
class FastRunner implements TaskRunner {
  async run(_task: TaskRecord, onProgress: (p: number) => void): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 5))
    onProgress(50)
    return { ok: true }
  }
}

describe('TaskManager', () => {
  let model: GraphModel
  let manager: TaskManager

  beforeEach(() => {
    model = new GraphModel()
    model.createCanvas('t1')
    manager = new TaskManager(model, new FastRunner())
  })

  it('创建任务立即返回 task_id 且状态 pending', () => {
    const node = model.createNode('t1', { type: 'image' })
    const task = manager.createTask('image', 't1', node.id, { prompt: 'a cat' })
    expect(task.id).toBeTruthy()
    expect(task.status).toBe('pending')
    expect(task.kind).toBe('image')
  })

  it('查询任务状态', () => {
    const node = model.createNode('t1', { type: 'image' })
    const task = manager.createTask('image', 't1', node.id)
    const found = manager.getTaskStatus(task.id)
    expect(found).not.toBeNull()
    expect(found!.id).toBe(task.id)
  })

  it('任务完成后自动回写节点状态 done/progress=100', async () => {
    const node = model.createNode('t1', { type: 'image' })
    manager.createTask('image', 't1', node.id)
    // 等待后台处理完成
    await new Promise((r) => setTimeout(r, 50))
    const updated = model.getNode('t1', node.id)!
    expect(updated.data.status).toBe('done')
    expect(updated.data.progress).toBe(100)
  })

  it('不同画布任务互相隔离', () => {
    model.createCanvas('t2')
    const n1 = model.createNode('t1', { type: 'image' })
    const n2 = model.createNode('t2', { type: 'text' })
    const t1 = manager.createTask('image', 't1', n1.id)
    const t2 = manager.createTask('text', 't2', n2.id)
    expect(t1.id).not.toBe(t2.id)
  })
})
