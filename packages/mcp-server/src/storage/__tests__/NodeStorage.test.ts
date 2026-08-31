import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NodeStorage } from '../NodeStorage'

describe('NodeStorage', () => {
  let tmpDir: string
  let storage: NodeStorage

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-node-storage-'))
    storage = new NodeStorage(tmpDir)
    await storage.init()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('初始化创建索引', async () => {
    const list = storage.listProjects()
    expect(list).toEqual([])
  })

  it('创建项目写索引', async () => {
    const meta = await storage.createProject('任务一', 't1')
    expect(meta.id).toBe('t1')
    expect(storage.hasProject('t1')).toBe(true)
    expect(storage.listProjects()).toHaveLength(1)
  })

  it('自动生成 taskId', async () => {
    const meta = await storage.createProject('无名')
    expect(meta.id).toBeTruthy()
    expect(meta.id.length).toBeGreaterThan(10)
  })

  it('保存/加载画布往返一致', async () => {
    await storage.createProject('t', 't1')
    const nodes = [
      { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { label: 'a' } },
      { id: 'n2', type: 'text', position: { x: 10, y: 10 }, data: { label: 'b' } },
    ]
    const edges = [{ id: 'e1', source: 'n1', target: 'n2', data: {} }]
    await storage.saveCanvas('t1', nodes, edges)

    const loaded = await storage.loadCanvas('t1')
    expect(loaded.nodes).toHaveLength(2)
    expect(loaded.edges).toHaveLength(1)
    expect(loaded.nodes[0].data.label).toBe('a')
  })

  it('保存时清洗临时节点和运行时字段', async () => {
    await storage.createProject('t', 't1')
    const nodes = [
      { id: 'temp-xyz', type: 'tempTarget', data: { isTemp: true } },
      { id: 'real', type: 'image', data: { imageUrl: 'blob:xxx', _editing: true, label: 'ok' } },
    ]
    await storage.saveCanvas('t1', nodes, [])
    const loaded = await storage.loadCanvas('t1')
    expect(loaded.nodes).toHaveLength(1)
    expect(loaded.nodes[0].id).toBe('real')
    expect(loaded.nodes[0].data.imageUrl).toBeUndefined()
    expect(loaded.nodes[0].data._editing).toBeUndefined()
    expect(loaded.nodes[0].data.label).toBe('ok')
  })

  it('加载不存在的画布返回空', async () => {
    const data = await storage.loadCanvas('ghost')
    expect(data.nodes).toEqual([])
    expect(data.edges).toEqual([])
  })

  it('删除项目移除数据', async () => {
    await storage.createProject('t', 't1')
    await storage.saveCanvas('t1', [{ id: 'n', type: 'text' }], [])
    await storage.deleteProject('t1')
    expect(storage.hasProject('t1')).toBe(false)
    const data = await storage.loadCanvas('t1')
    expect(data.nodes).toEqual([])
  })

  it('跨实例持久化（重启恢复）', async () => {
    await storage.createProject('t', 't1')
    await storage.saveCanvas('t1', [{ id: 'n', type: 'text' }], [])

    // 模拟重启
    const storage2 = new NodeStorage(tmpDir)
    await storage2.init()
    expect(storage2.hasProject('t1')).toBe(true)
    const loaded = await storage2.loadCanvas('t1')
    expect(loaded.nodes).toHaveLength(1)
  })
})
