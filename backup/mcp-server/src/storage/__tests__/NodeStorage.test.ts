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

  // ==================== 画布资源（每画布文件夹 + 内容哈希去重） ====================

  it('保存画布资源：写入 project-{canvas}/assets/ 且文件名=sha256+扩展名', async () => {
    await storage.createProject('t', 'cv1')
    const buf = Buffer.from('hello-image-bytes')
    const { assetId, stored } = await storage.saveResource('cv1', 'photo.png', buf)
    expect(assetId).toHaveLength(64) // sha256 hex
    expect(stored).toBe(`${assetId}.png`)
    // 字节确实落在画布 assets 目录
    const file = path.join(tmpDir, 'project-cv1', 'assets', stored)
    const onDisk = await fs.readFile(file)
    expect(onDisk.toString()).toBe('hello-image-bytes')
  })

  it('内容去重：同字节只存一份，assetId 相同', async () => {
    await storage.createProject('t', 'cv1')
    const first = await storage.saveResource('cv1', 'a.png', Buffer.from('same'))
    const second = await storage.saveResource('cv1', 'b.png', Buffer.from('same'))
    expect(second.assetId).toBe(first.assetId)
    const dir = path.join(tmpDir, 'project-cv1', 'assets')
    const entries = await fs.readdir(dir)
    expect(entries).toHaveLength(1) // 只存一份
  })

  it('不同画布资源互不干扰（一画布一文件夹）', async () => {
    await storage.createProject('t', 'cv1')
    await storage.createProject('t', 'cv2')
    const a = await storage.saveResource('cv1', 'x.png', Buffer.from('aaa'))
    const b = await storage.saveResource('cv2', 'y.png', Buffer.from('aaa'))
    expect(a.assetId).toBe(b.assetId) // 内容相同
    const d1 = await fs.readdir(path.join(tmpDir, 'project-cv1', 'assets'))
    const d2 = await fs.readdir(path.join(tmpDir, 'project-cv2', 'assets'))
    expect(d1).toHaveLength(1)
    expect(d2).toHaveLength(1)
  })

  it('读取资源往返一致，缺失返回 null', async () => {
    await storage.createProject('t', 'cv1')
    const { stored } = await storage.saveResource('cv1', 'img.png', Buffer.from('payload'))
    const buf = await storage.readResource('cv1', stored)
    expect(buf?.toString()).toBe('payload')
    const missing = await storage.readResource('cv1', 'nosuchfile.png')
    expect(missing).toBeNull()
  })

  it('删除资源', async () => {
    await storage.createProject('t', 'cv1')
    const { stored } = await storage.saveResource('cv1', 'a.png', Buffer.from('data'))
    expect(await storage.deleteResource('cv1', stored)).toBe(true)
    expect(await storage.readResource('cv1', stored)).toBeNull()
    expect(await storage.deleteResource('cv1', stored)).toBe(false)
  })
})
