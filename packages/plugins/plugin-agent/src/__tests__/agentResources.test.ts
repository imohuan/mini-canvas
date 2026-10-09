/** 引用资源标签：技能/MCP/节点的标记（ref）必须带对的 kind 与载荷 */
import { describe, it, expect } from 'vitest'
import { skillResources, mcpResources, nodeResources, assetResource, assetExtOf } from '../agentResources'

describe('技能标签', () => {
  it('带 skill 标记，载荷 = SKILL.md 路径', () => {
    const [r] = skillResources([{ name: 'archify', description: '画架构图', dir: 'D:/a/skills/archify' }])
    expect(r.ref).toEqual({ kind: 'skill', name: 'archify', value: 'D:/a/skills/archify/SKILL.md' })
  })

  it('拿不到目录时不给路径（标记仍成立）', () => {
    const [r] = skillResources([{ name: 'x', description: '' }])
    expect(r.ref).toEqual({ kind: 'skill', name: 'x', value: '' })
  })
})

describe('MCP 标签', () => {
  it('带 mcp 标记，且**不带**地址（后端靠名字连服务）', () => {
    const [r] = mcpResources([{ name: 'smart', config: { url: 'http://x/mcp' } }])
    expect(r.ref).toEqual({ kind: 'mcp', name: 'smart' })
    expect(r.ref?.value).toBeUndefined()
  })
})

describe('节点标签', () => {
  it('载荷 = 画布id#节点id，且带 onClick 聚焦回调', () => {
    let focused = ''
    const [r] = nodeResources([{ id: 'n1', name: '立绘', type: 'image' }], 'default', (id) => (focused = id))
    expect(r.ref).toEqual({ kind: 'node', name: '立绘', value: 'default#n1' })
    r.onClick?.(r)
    expect(focused).toBe('n1')
  })

  it('没有名字时用 id 当展示名', () => {
    const [r] = nodeResources([{ id: 'n2', name: '', type: 'text' }], 'c')
    expect(r.name).toBe('n2')
    expect(r.ref?.value).toBe('c#n2')
  })
})

describe('资产标签（引用要能点开看东西）', () => {
  it('文件：带 path 与 ext（点标签 → 全屏预览）', () => {
    const r = assetResource({ id: 'a1', name: '图.png', url: '/api/assets/files/ab.png', path: 'D:/d/assets/files/ab.png', folderId: 'f1' })
    expect(r.ref).toEqual({ kind: 'asset', name: '图.png', value: 'D:/d/assets/files/ab.png', ext: 'png', folderId: 'f1' })
  })

  it('没有 path 时退回落 url（老数据：后端还没补 path）', () => {
    const r = assetResource({ name: 'a.mp4', url: '/api/assets/files/ab.mp4' })
    expect(r.ref?.value).toBe('/api/assets/files/ab.mp4')
    expect(r.ref?.ext).toBe('mp4')
  })

  /**
   * 目录名可能带点号（「素材 v1.2」）—— 不显式标 isFolder 的话，扩展名推断会把目录当文件，
   * 点一下变成弹图片预览（用户报过「点文件夹弹出图片」）。
   */
  it('名字带点号的文件夹仍然不带 ext（靠 isFolder 显式标出）', () => {
    const r = assetResource({ id: 'f9', name: '素材 v1.2', url: '', path: 'D:/d/assets/files', folderId: 'f9', isFolder: true })
    expect(r.ref?.ext).toBeUndefined()
    expect(r.ref?.folderId).toBe('f9')
  })

  it('onClick 抛出去的是「事件载荷那份」（文件带 ext、文件夹只有 folderId）', () => {
    const seen: unknown[] = []
    assetResource({ name: 'a.png', url: '/x/a.png', path: 'D:/x/a.png', folderId: 'f1' }, (r) => seen.push(r)).onClick?.(undefined as never)
    assetResource({ name: 'F', url: '', folderId: 'f1', isFolder: true }, (r) => seen.push(r)).onClick?.(undefined as never)
    expect(seen).toEqual([
      { name: 'a.png', path: 'D:/x/a.png', ext: 'png', folderId: 'f1' },
      { name: 'F', folderId: 'f1' },
    ])
  })

  /** 文件夹引用的 ref 也**不带 ext**（读它的人靠这一点认出是目录） */
  it('文件夹引用：ref 里只有 folderId，没有 ext', () => {
    const r = assetResource({ id: 'f1', name: '待分类资产', url: '', path: 'D:/d/assets/files', folderId: 'f1', isFolder: true })
    expect(r.ref).toEqual({ kind: 'asset', name: '待分类资产', value: 'D:/d/assets/files', folderId: 'f1' })
    expect(r.ref?.ext).toBeUndefined()
  })

  it('扩展名从 path / url / name 三处都能取（取不到给空串）', () => {
    expect(assetExtOf({ path: 'D:/a/b.JPEG' })).toBe('jpeg')
    expect(assetExtOf({ url: '/api/assets/files/ab.mp3?v=1' })).toBe('mp3')
    expect(assetExtOf({ name: 'x.webp' })).toBe('webp')
    expect(assetExtOf({ name: '没有扩展名' })).toBe('')
  })
})
