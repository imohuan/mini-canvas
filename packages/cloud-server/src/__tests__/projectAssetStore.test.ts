/**
 * ProjectStore / AssetStore 单测（纯落盘逻辑，不启服务）。
 *
 * 锁用户口径的三件事：
 * 1. 项目 → 多张画布（画布文件夹路径不变，归属记在索引里）；
 * 2. 有 default 项目兜底（老画布不丢）；
 * 3. 资产 = 生成产物（按引用登记）+ 自己上传（字节落 assets/files）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectStore, DEFAULT_PROJECT_ID } from '../store/projectStore'
import { AssetStore, kindOfName } from '../store/assetStore'

  /**
   * 资产的**本机绝对路径**（用户口径：技能给的就是绝对路径，图片也应一致）。
   *
   * 为什么要 path：引用要能复制到本机 Agent（Codex 等）直接用 —— 给相对 URL 的话对方得先猜 base、
   * 再下载到本地才能读，绕好几步。绝对路径一步 read_file 到位（这就是「更快的方式」）。
   */
  it('上传资产：带本机绝对路径（指向 assets/files 下的真实文件）', async () => {
    const s = new AssetStore(root)
    const a = await s.saveUpload(new Uint8Array([1, 2, 3]), 'x.png')
    expect(a.path, '上传资产应有 path').toBeTruthy()
    expect(path.isAbsolute(a.path!)).toBe(true)
    await expect(fs.access(a.path!)).resolves.toBeUndefined()
  })

  it('画布内生成产物：path 指向 canvases/<id>/resources 下的真实文件', async () => {
    const s = new AssetStore(root)
    const a = await s.addByUrl({ url: '/api/canvases/c1/resources/abcdef0123456789.png', canvasId: 'c1' })
    expect(a.path, '画布资源应有 path').toBeTruthy()
    expect(a.path!.replace(/\\/g, '/')).toContain('/canvases/c1/resources/abcdef0123456789.png')
  })

  it('外部地址（本机没字节）：path 为空，不瞎编', async () => {
    const s = new AssetStore(root)
    const a = await s.addByUrl({ url: 'http://localhost:8033/api/resources/x.png', canvasId: 'c1' })
    expect(a.path).toBeUndefined()
  })

  /**
   * 惰性迁移：老登记表没有 path 字段（那时还没这个概念）。
   * 不做迁移的话，老资产永远「不可用」—— 菜单里「添加到 Agent / 添加到画布」不出现。
   */
  it('老数据（index.json 里没 path）读到时会自动补上并写回', async () => {
    // 直接写一条缺 path 的老记录（模拟升级前的磁盘状态）
    const legacy = [{ id: 'legacy-1', name: 'x.png', kind: 'image', url: '/api/assets/files/aabbccdd11223344.png', source: 'upload', createdAt: 1 }]
    await fs.mkdir(path.join(root, 'assets'), { recursive: true })
    await fs.writeFile(path.join(root, 'assets', 'index.json'), JSON.stringify(legacy))
    const s = new AssetStore(root)
    const list = await s.list()
    expect(list[0].path, '读到时应补上 path').toBeTruthy()
    // 并且写回了磁盘（下次不必再推）
    const onDisk = JSON.parse(await fs.readFile(path.join(root, 'assets', 'index.json'), 'utf8'))
    expect(onDisk[0].path).toBeTruthy()
  })

let root: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-proj-'))
})
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('ProjectStore', () => {
  it('首次 listOrSeed 补一个 default 项目', async () => {
    const s = new ProjectStore(root)
    const list = await s.listOrSeed()
    expect(list.map((p) => p.id)).toContain(DEFAULT_PROJECT_ID)
    // 再读一次不重复补
    expect((await s.listOrSeed()).filter((p) => p.id === DEFAULT_PROJECT_ID)).toHaveLength(1)
  })

  it('新建项目 / 改名 / 删项目（default 不可删）', async () => {
    const s = new ProjectStore(root)
    const p = await s.create('  我的视频  ')
    expect(p.name).toBe('我的视频')
    expect((await s.list()).some((x) => x.id === p.id)).toBe(true)
    const renamed = await s.rename(p.id, '改名了')
    expect(renamed?.name).toBe('改名了')
    expect(await s.remove(p.id)).toBe(true)
    expect(await s.remove(DEFAULT_PROJECT_ID)).toBe(false)
  })

  it('一个项目下多张画布：建目录 + 记索引，且按项目过滤', async () => {
    const s = new ProjectStore(root)
    const p = await s.create('P1')
    const c1 = await s.createCanvas(p.id, '画布甲')
    const c2 = await s.createCanvas(p.id, '画布乙')
    if ('error' in c1 || 'error' in c2) throw new Error('建画布失败')
    // 画布文件夹真的建出来了（路径不变，仍在 canvases/<id>/）
    await expect(fs.access(path.join(root, 'canvases', c1.id, 'canvas.json'))).resolves.toBeUndefined()

    const mine = await s.listCanvases(p.id, [c1.id, c2.id])
    expect(mine.map((e) => e.name)).toEqual(['画布甲', '画布乙'])
    expect(await s.listCanvases('别的项目', [c1.id, c2.id])).toEqual([])
  })

  it('画布目录存在但索引缺失（老库）→ 归 default，不丢', async () => {
    const s = new ProjectStore(root)
    await fs.mkdir(path.join(root, 'canvases', 'legacy'), { recursive: true })
    const list = await s.listCanvases(DEFAULT_PROJECT_ID, ['legacy'])
    expect(list).toEqual([{ id: 'legacy', name: 'legacy', projectId: DEFAULT_PROJECT_ID, createdAt: 0 }])
  })

  it('删项目会连带摘掉它的画布索引', async () => {
    const s = new ProjectStore(root)
    const p = await s.create('P2')
    await s.createCanvas(p.id, 'C')
    await s.remove(p.id)
    expect(await s.readIndex()).toEqual([])
  })
})

describe('AssetStore', () => {
  it('按地址登记生成产物：同 url 幂等', async () => {
    const s = new AssetStore(root)
    const a = await s.addByUrl({ url: '/api/canvases/c1/resources/abc.png', canvasId: 'c1' })
    expect(a.kind).toBe('image')
    expect(a.source).toBe('generated')
    const again = await s.addByUrl({ url: '/api/canvases/c1/resources/abc.png' })
    expect(again.id).toBe(a.id)
    expect(await s.list()).toHaveLength(1)
  })

  it('上传资产：字节落 assets/files、内容寻址去重、url 指回', async () => {
    const s = new AssetStore(root)
    const bytes = new Uint8Array([1, 2, 3, 4])
    const a = await s.saveUpload(bytes, '我 的图.png')
    expect(a.source).toBe('upload')
    expect(a.url.startsWith('/api/assets/files/')).toBe(true)
    expect(a.url.endsWith('.png')).toBe(true)
    const back = await s.readFile(a.url.split('/').pop()!)
    expect(Array.from(back ?? [])).toEqual([1, 2, 3, 4])
    // 同内容再传一次不产生第二条
    await s.saveUpload(bytes, '另一个名字.png')
    expect(await s.list()).toHaveLength(1)
  })

  it('画布删除 → 摘掉它的生成产物；上传资产不受影响', async () => {
    const s = new AssetStore(root)
    await s.addByUrl({ url: '/api/canvases/c1/resources/a.mp3', canvasId: 'c1' })
    await s.saveUpload(new Uint8Array([9]), 'x.mp3')
    await s.removeByCanvas('c1')
    const rest = await s.list()
    expect(rest).toHaveLength(1)
    expect(rest[0].source).toBe('upload')
  })

  it('kindOfName 按扩展名分类', () => {
    expect(kindOfName('a.png')).toBe('image')
    expect(kindOfName('b.mp4')).toBe('video')
    expect(kindOfName('c.mp3')).toBe('audio')
    expect(kindOfName('d.xyz')).toBe('other')
  })
})
