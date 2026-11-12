/**
 * 参考图解析（tasks/resourceResolver）单测 —— 真落盘、真读文件（mkdtemp 临时目录）。
 *
 * 锁的是用户实测的那条坑：节点里存的是**资产地址** `/api/assets/files/<hash>.jpeg` 时，
 * 以前它落到"原样返回"，相对路径被直接发给 web2api —— 它当自己 uploads 目录下的相对文件找，
 * 报「图片不存在（已尝试 …\web2api\uploads\api\assets\files\ec96ba4464cbf531.jpeg）」。
 * 三种形态（res: / 画布资源路径 / 资产地址）都必须是 data URL，认不出才原样返回。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CanvasResourceStore } from '../store/canvasResources'
import { AssetStore } from '../store/assetStore'
import { makeResolveResourceUrl } from '../tasks/resourceResolver'

/** 最小 PNG 头（喂给嗅探用；不必是一张能解码的完整图） */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
/** 最小 JPEG 头 */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64')

let root: string
let canvasResources: CanvasResourceStore
let assetStore: AssetStore
let resolveRef: (canvasId: string, ref: string) => Promise<string>

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-resolver-'))
  canvasResources = new CanvasResourceStore(root)
  assetStore = new AssetStore(root)
  resolveRef = makeResolveResourceUrl({
    canvasResources,
    readAssetBytes: (name) => assetStore.readFile(name),
  })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('画布资源：URL 形态解析成 data URL', () => {
  it('/api/canvases/<id>/resources/<hash> → data URL（按扩展名给 mime）', async () => {
    const saved = await canvasResources.save('c1', PNG, '.png')
    const url = '/api/canvases/c1/resources/' + saved.hashName
    expect(await resolveRef('c1', url)).toBe('data:image/png;base64,' + b64(PNG))
    // save 的返回值就是这个 URL
    expect(saved.url).toBe(url)
    expect(await resolveRef('c1', saved.url)).toBe('data:image/png;base64,' + b64(PNG))
  })

  it('带 origin 的完整地址也认', async () => {
    const saved = await canvasResources.save('c1', JPEG, '.jpeg')
    const url = 'http://127.0.0.1:8865/api/canvases/c1/resources/' + saved.hashName
    expect(await resolveRef('c1', url)).toBe('data:image/jpeg;base64,' + b64(JPEG))
  })

  it('无扩展名的 PNG → mime 靠头部字节嗅探补出来（不靠文件名猜）', async () => {
    const saved = await canvasResources.save('c1', PNG)
    expect(saved.hashName).toMatch(/^[0-9a-f]{16}$/)
    expect(await resolveRef('c1', saved.url)).toBe('data:image/png;base64,' + b64(PNG))
  })

  it('别的画布的资源引用不串台（画布 id 不匹配 = 认不出，原样返回）', async () => {
    const saved = await canvasResources.save('c2', PNG, '.png')
    expect(saved.url).toBe('/api/canvases/c2/resources/' + saved.hashName)
    expect(await resolveRef('c1', saved.url)).toBe(saved.url)
  })
})

describe('资产地址：/api/assets/files/<hash>（用户实测的坑）', () => {
  it('相对地址 → data URL', async () => {
    const asset = await assetStore.saveUpload(JPEG, 'x.jpeg')
    expect(await resolveRef('c1', asset.url)).toBe('data:image/jpeg;base64,' + b64(JPEG))
  })

  it('带 origin 的完整地址 → 同一份 data URL', async () => {
    const asset = await assetStore.saveUpload(JPEG, 'x.jpeg')
    const url = 'http://127.0.0.1:8865' + asset.url
    expect(await resolveRef('c1', url)).toBe('data:image/jpeg;base64,' + b64(JPEG))
  })

  it('无扩展名的资产（内容哈希落盘）→ 嗅探补 mime', async () => {
    // saveUpload 只认白名单扩展名；没有扩展名时 hashName 就是纯哈希
    const asset = await assetStore.saveUpload(PNG, 'noext')
    expect(asset.url).toMatch(/\/api\/assets\/files\/[0-9a-f]{16}$/)
    expect(await resolveRef('c1', asset.url)).toBe('data:image/png;base64,' + b64(PNG))
  })
})

describe('认不出 / 读不到 → 原样返回（不编一个更假的地址）', () => {
  it('外部地址原样', async () => {
    const url = 'https://cdn.example.com/a.png'
    expect(await resolveRef('c1', url)).toBe(url)
  })

  it('其它同源地址（非资源、非资产）原样', async () => {
    expect(await resolveRef('c1', '/foo/bar.png')).toBe('/foo/bar.png')
  })

  it('资产地址指向不存在的文件 → 原样', async () => {
    const url = '/api/assets/files/0123456789abcdef.jpeg'
    expect(await resolveRef('c1', url)).toBe(url)
  })

  it('带子路径 / 越界的名字不认（防目录穿越，不读文件）', async () => {
    for (const bad of [
      '/api/assets/files/../secret.png',
      '/api/assets/files/sub/dir.png',
      '/api/canvases/c1/resources/../../canvas.json',
    ]) {
      expect(await resolveRef('c1', bad), bad).toBe(bad)
    }
  })
})
