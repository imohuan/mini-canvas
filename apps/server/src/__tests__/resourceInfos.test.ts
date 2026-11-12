/**
 * 资源「类型信息」单测（任务 B）。
 *
 * 为什么值得单独锁：MCP 的 resource_list 以前只给一串文件名，调用方只能按名字猜类型。
 * 而画布资源按**内容哈希**落盘、很多没有扩展名（既有 PNG 也有 OggS 音频）——
 * 音频被当图片塞进 <img> 就是裂图（用户实测）。所以类型要么来自扩展名，要么来自**头部字节嗅探**。
 *
 * 两条链都测：① 纯函数嗅探（不碰磁盘）；② CanvasDocument.listResourceInfos（真落盘、真读文件头）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sniffMimeFromHead, kindOfMime } from '../store/mime'
import { CanvasResourceStore } from '../store/canvasResources'
import { CanvasStore } from '../store/canvasStore'
import { CanvasDocument } from '../mcp/canvasDoc'
import { createCloudServer, type CloudServer } from '../server'

/** 每种格式的最小魔数头（只够嗅探用，不要求是一张/一段完整媒体） */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const MP3_ID3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00])
const MP3_FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00])
const MP4 = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])
const AVIF = new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45])
const BMP = new Uint8Array([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00])

describe('sniffMimeFromHead：只认白名单里的魔数', () => {
  it('图片格式', () => {
    expect(sniffMimeFromHead(PNG)).toBe('image/png')
    expect(sniffMimeFromHead(JPEG)).toBe('image/jpeg')
    expect(sniffMimeFromHead(GIF)).toBe('image/gif')
    expect(sniffMimeFromHead(WEBP)).toBe('image/webp')
    expect(sniffMimeFromHead(BMP)).toBe('image/bmp')
    expect(sniffMimeFromHead(AVIF)).toBe('image/avif')
  })

  it('视频 / 音频格式', () => {
    expect(sniffMimeFromHead(MP4)).toBe('video/mp4')
    expect(sniffMimeFromHead(OGG)).toBe('audio/ogg')
    expect(sniffMimeFromHead(MP3_ID3)).toBe('audio/mpeg')
    expect(sniffMimeFromHead(MP3_FRAME)).toBe('audio/mpeg')
    expect(sniffMimeFromHead(WAV)).toBe('audio/wav')
  })

  it('认不出的一律 undefined（宁可不认，也不错认）', () => {
    expect(sniffMimeFromHead(new Uint8Array(16))).toBeUndefined()
    expect(sniffMimeFromHead(new TextEncoder().encode('hello world!!!!!!!!'))).toBeUndefined()
    expect(sniffMimeFromHead(new TextEncoder().encode('{"a":1}'))).toBeUndefined()
    expect(sniffMimeFromHead(new Uint8Array(0))).toBeUndefined()
  })

  it('短头不越界（只给了几个字节也不会崩）', () => {
    expect(sniffMimeFromHead(new Uint8Array([0x89]))).toBeUndefined()
    expect(sniffMimeFromHead(new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74]))).toBeUndefined()
  })
})

describe('kindOfMime：给前端判断"能不能进 <img>"', () => {
  it('按主类型分四类', () => {
    expect(kindOfMime('image/png')).toBe('image')
    expect(kindOfMime('video/mp4')).toBe('video')
    expect(kindOfMime('audio/ogg')).toBe('audio')
    expect(kindOfMime('application/octet-stream')).toBe('other')
    expect(kindOfMime('application/pdf')).toBe('other')
  })

  it('带参数 / 大小写混着写也认', () => {
    expect(kindOfMime('IMAGE/PNG; charset=binary')).toBe('image')
    expect(kindOfMime('Audio/Ogg')).toBe('audio')
  })
})

let dir: string
let doc: CanvasDocument
let resources: CanvasResourceStore

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-res-infos-'))
  resources = new CanvasResourceStore(dir)
  doc = new CanvasDocument(new CanvasStore(dir), resources)
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('CanvasDocument.listResourceInfos', () => {
  it('带扩展名的按扩展名、无扩展名的按文件头 —— image / image / audio 分得开', async () => {
    const named = await doc.saveResource(PNG, { fileName: 'a.png' })
    const noExt = await doc.saveResource(PNG)
    const ogg = await doc.saveResource(OGG)

    const infos = await doc.listResourceInfos()
    const byName = new Map(infos.map((i) => [i.name, i]))
    expect(infos.map((i) => i.name).sort()).toEqual([named.hashName, noExt.hashName, ogg.hashName].sort())

    expect(byName.get(named.hashName)).toEqual({
      name: named.hashName,
      mime: 'image/png',
      kind: 'image',
      url: '/api/canvases/default/resources/' + named.hashName,
    })
    // 没扩展名的 PNG：kind 仍是 image（靠嗅探，不是靠名字）
    expect(byName.get(noExt.hashName)?.kind).toBe('image')
    expect(byName.get(noExt.hashName)?.mime).toBe('image/png')
    // 没扩展名的 OggS：必须是 audio —— 以前前端把它当图渲染，就是裂图
    expect(byName.get(ogg.hashName)?.kind).toBe('audio')
    expect(byName.get(ogg.hashName)?.mime).toBe('audio/ogg')
  })

  it('确有扩展名但与内容不符时，以扩展名为准（嗅探只补空位，不推翻已知类型）', async () => {
    const saved = await doc.saveResource(OGG, { fileName: 'x.png' })
    const infos = await doc.listResourceInfos()
    const one = infos.find((i) => i.name === saved.hashName)
    expect(one?.mime).toBe('image/png')
    expect(one?.kind).toBe('image')
  })

  it('空画布 → 空清单（不是错误）', async () => {
    expect(await doc.listResourceInfos()).toEqual([])
  })

  it('readHead 只读文件头、不整读（大文件也只返回前 n 字节）', async () => {
    const big = new Uint8Array(1024 * 64)
    big.set(PNG.subarray(0, 8), 0)
    const saved = await resources.save('default', big)
    const head = await resources.readHead('default', saved.hashName)
    expect(head?.byteLength).toBe(16)
    expect(Array.from(head?.subarray(0, 4) ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47])
    // 名字不合法 / 不存在 → undefined（与 read 同口径）
    expect(await resources.readHead('default', '../x.png')).toBeUndefined()
    expect(await resources.readHead('default', '0123456789abcdef.png')).toBeUndefined()
  })
})

describe('listResourceInfos 与 listResources 口径一致', () => {
  it('老接口仍返回名字数组（还有别的调用方，不能改形状）', async () => {
    const a = await doc.saveResource(PNG, { fileName: 'a.png' })
    const names = await doc.listResources()
    expect(names).toEqual([a.hashName])
    expect((await doc.listResourceInfos()).map((i) => i.name)).toEqual(names)
  })
})

describe('MCP resource_list 工具：类型信息要真的送到调用方手里', () => {
  /**
   * 光测 CanvasDocument 抓不到「工具面没接上」这类错（方法写好了却没被工具调用）。
   * 所以这里真起服务、真发一次 MCP 调用，核对返回形状。
   */
  it('经 /mcp 调用：每个资源带 name / mime / kind / url', async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-res-mcp-'))
    let srv: CloudServer | undefined
    try {
      // 造一张非默认画布 + 两个资源：一个带扩展名的 PNG、一个无扩展名的 OggS
      await fs.mkdir(path.join(dir2, 'canvases', 'c1'), { recursive: true })
      await fs.writeFile(path.join(dir2, 'canvases', 'c1', 'canvas.json'), JSON.stringify({ nodes: [], edges: [] }), 'utf8')
      const store = new CanvasResourceStore(dir2)
      const pngSaved = await store.save('c1', PNG, '.png')
      const oggSaved = await store.save('c1', OGG)

      srv = await createCloudServer({ dir: dir2, watchProviders: false })
      const post = (body: unknown) =>
        srv!.app.fetch(
          new Request('http://localhost/mcp', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
            body: JSON.stringify(body),
          }),
        )
      await (await post({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      })).text()
      const text = await (await post({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'resource_list', arguments: { canvasId: 'c1' } },
      })).text()
      const line = text.split('\n').find((l) => l.startsWith('data:')) ?? text
      const json = JSON.parse(line.replace(/^data:\s*/, ''))
      const r = JSON.parse(json.result.content[0].text) as {
        ok: boolean
        count: number
        resources: Array<{ name: string; mime: string; kind: string; url: string }>
      }
      expect(r.ok).toBe(true)
      expect(r.count).toBe(2)
      const byName = new Map(r.resources.map((x) => [x.name, x]))
      expect(byName.get(pngSaved.hashName)?.kind).toBe('image')
      expect(byName.get(pngSaved.hashName)?.mime).toBe('image/png')
      expect(byName.get(pngSaved.hashName)?.url).toBe('/api/canvases/c1/resources/' + pngSaved.hashName)
      // 关键：没扩展名的音频必须是 audio，前端才不会把它塞进 <img>
      expect(byName.get(oggSaved.hashName)?.kind).toBe('audio')
      expect(byName.get(oggSaved.hashName)?.mime).toBe('audio/ogg')
    } finally {
      srv?.stop()
      await fs.rm(dir2, { recursive: true, force: true })
    }
  })
})
