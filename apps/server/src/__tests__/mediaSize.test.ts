/**
 * 从字节读图片 / 视频尺寸（后台收产物时用来补节点的 imageWidth/Height、videoWidth/Height）。
 * 覆盖生成产物最常见的几种容器；认不出必须返回 null（绝不猜）。
 */
import { describe, it, expect } from 'vitest'
import {
  imageSizeFromBytes,
  videoSizeFromBytes,
  mediaKindFromName,
  videoDurationFromBytes,
  audioDurationFromBytes,
  probeMedia,
} from '../tasks/mediaSize'

/** 造一个 PNG 头（宽高在 IHDR） */
function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(24)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  b.set([0, 0, 0, 13], 8)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  b[16] = (w >> 24) & 0xff; b[17] = (w >> 16) & 0xff; b[18] = (w >> 8) & 0xff; b[19] = w & 0xff
  b[20] = (h >> 24) & 0xff; b[21] = (h >> 16) & 0xff; b[22] = (h >> 8) & 0xff; b[23] = h & 0xff
  return b
}

/** 造一个最小 JPEG：SOI + SOF0（宽高） */
function jpeg(w: number, h: number): Uint8Array {
  const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0])
  b[7] = (h >> 8) & 0xff; b[8] = h & 0xff
  b[9] = (w >> 8) & 0xff; b[10] = w & 0xff
  return b
}

describe('imageSizeFromBytes', () => {
  it('PNG', () => expect(imageSizeFromBytes(png(1152, 2048))).toEqual({ width: 1152, height: 2048 }))
  it('JPEG', () => expect(imageSizeFromBytes(jpeg(1520, 2720))).toEqual({ width: 1520, height: 2720 }))
  it('GIF', () => {
    const b = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0x90, 0x01])
    expect(imageSizeFromBytes(b)).toEqual({ width: 320, height: 400 })
  })
  it('认不出 → null（不猜）', () => {
    expect(imageSizeFromBytes(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(imageSizeFromBytes(new Uint8Array(0))).toBeNull()
  })
})

describe('videoSizeFromBytes（MP4 tkhd）', () => {
  it('读出 16.16 定点宽高', () => {
    // 造一个最小 moov>trak>tkhd（version 0）：宽 1080 高 1920
    const box = (type: string, payload: Uint8Array): Uint8Array => {
      const out = new Uint8Array(8 + payload.length)
      const size = out.length
      out[0] = (size >> 24) & 0xff; out[1] = (size >> 16) & 0xff; out[2] = (size >> 8) & 0xff; out[3] = size & 0xff
      for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
      out.set(payload, 8)
      return out
    }
    const tkhdPayload = new Uint8Array(84) // version0：宽高偏移 76
    const put32 = (o: number, v: number) => { tkhdPayload[o] = (v >>> 24) & 0xff; tkhdPayload[o + 1] = (v >>> 16) & 0xff; tkhdPayload[o + 2] = (v >>> 8) & 0xff; tkhdPayload[o + 3] = v & 0xff }
    put32(76, 1080 << 16)
    put32(80, 1920 << 16)
    const tkhd = box('tkhd', tkhdPayload)
    const trak = box('trak', tkhd)
    const moov = box('moov', trak)
    const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d]))
    const file = new Uint8Array(ftyp.length + moov.length)
    file.set(ftyp, 0); file.set(moov, ftyp.length)
    expect(videoSizeFromBytes(file)).toEqual({ width: 1080, height: 1920 })
  })
  it('不是 mp4 → null', () => expect(videoSizeFromBytes(png(4, 4))).toBeNull())
})

describe('mediaKindFromName', () => {
  it('按后缀分流', () => {
    expect(mediaKindFromName('a.jpeg')).toBe('image')
    expect(mediaKindFromName('a.PNG')).toBe('image')
    expect(mediaKindFromName('v.mp4')).toBe('video')
    expect(mediaKindFromName('s.ogg')).toBe('audio')
    expect(mediaKindFromName('x.bin')).toBe('unknown')
  })
})

/** 通用盒子构造函数（MP4 系列） */
function mp4Box(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  const size = out.length
  out[0] = (size >>> 24) & 0xff; out[1] = (size >>> 16) & 0xff; out[2] = (size >>> 8) & 0xff; out[3] = size & 0xff
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(payload, 8)
  return out
}
function put32(a: Uint8Array, o: number, v: number): void {
  a[o] = (v >>> 24) & 0xff; a[o + 1] = (v >>> 16) & 0xff; a[o + 2] = (v >>> 8) & 0xff; a[o + 3] = v & 0xff
}
/** WAV 头里是多字节小端 */
function put32le(a: Uint8Array, o: number, v: number): void {
  a[o] = v & 0xff; a[o + 1] = (v >>> 8) & 0xff; a[o + 2] = (v >>> 16) & 0xff; a[o + 3] = (v >>> 24) & 0xff
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
/** WAV 的块长度是**小端**（与 MP4 的大端不同），单独造一个 */
function wavChunk(id: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length)
  for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i)
  const n = payload.length
  out[4] = n & 0xff; out[5] = (n >>> 8) & 0xff; out[6] = (n >>> 16) & 0xff; out[7] = (n >>> 24) & 0xff
  out.set(payload, 8)
  return out
}

describe('videoDurationFromBytes（MP4 mvhd）', () => {
  it('version 0：timescale=1000 / duration=5200 → 5200ms', () => {
    const mvhd = new Uint8Array(100)
    mvhd[0] = 0 // version 0
    put32(mvhd, 12, 1000) // timescale
    put32(mvhd, 16, 5200) // duration
    const file = concat(
      mp4Box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])),
      mp4Box('moov', mp4Box('mvhd', mvhd)),
    )
    expect(videoDurationFromBytes(file)).toBe(5200)
  })

  it('认不出 / 时长为 0 → null（不猜）', () => {
    expect(videoDurationFromBytes(png(4, 4))).toBeNull()
    const mvhd = new Uint8Array(100)
    put32(mvhd, 12, 1000)
    put32(mvhd, 16, 0)
    const file = concat(
      mp4Box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])),
      mp4Box('moov', mp4Box('mvhd', mvhd)),
    )
    expect(videoDurationFromBytes(file)).toBeNull()
  })
})

describe('audioDurationFromBytes', () => {
  it('WAV：16kHz / 16bit / 单声道，data 32000 字节 → 1000ms', () => {
    const fmt = new Uint8Array(16)
    fmt[0] = 1 // PCM
    fmt[2] = 1 // channels
    put32le(fmt, 4, 16000)
    put32le(fmt, 8, 32000) // byteRate
    const data = new Uint8Array(32000)
    const file = concat(
      new Uint8Array([0x52, 0x49, 0x46, 0x46]), // RIFF
      new Uint8Array([0, 0, 0, 0]), // 长度占位（解析不读它）
      new Uint8Array([0x57, 0x41, 0x56, 0x45]), // WAVE
      wavChunk('fmt ', fmt),
      wavChunk('data', data),
    )
    expect(audioDurationFromBytes(file, 'a.wav')).toBe(1000)
  })

  it('认不出 → null（前端用 audio loadedmetadata 兜底）', () => {
    expect(audioDurationFromBytes(new Uint8Array([1, 2, 3, 4]), 'x.ogg')).toBeNull()
  })
})

describe('probeMedia（历史卡片元数据）', () => {
  it('图片：尺寸 + 字节数，不给时长（不能瞎填 0）', () => {
    const out = probeMedia(png(800, 1200), 'a.png')
    expect(out.width).toBe(800)
    expect(out.height).toBe(1200)
    expect(out.bytes).toBe(24)
    expect(out.durationMs).toBeUndefined()
  })

  it('视频：宽高 + 时长', () => {
    const tkhdPayload = new Uint8Array(84)
    put32(tkhdPayload, 76, 720 << 16)
    put32(tkhdPayload, 80, 1280 << 16)
    const mvhd = new Uint8Array(100)
    put32(mvhd, 12, 600)
    put32(mvhd, 16, 3000)
    const file = concat(
      mp4Box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d])),
      mp4Box('moov', concat(mp4Box('mvhd', mvhd), mp4Box('trak', mp4Box('tkhd', tkhdPayload)))),
    )
    const out = probeMedia(file, 'v.mp4')
    expect(out.width).toBe(720)
    expect(out.height).toBe(1280)
    expect(out.durationMs).toBe(5000)
    expect(out.bytes).toBe(file.length)
  })
})
