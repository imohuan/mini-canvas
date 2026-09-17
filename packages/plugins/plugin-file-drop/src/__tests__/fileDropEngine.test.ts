import { describe, expect, it } from 'vitest'
import {
  classifyFile,
  clampText,
  fitImageSize,
  fitVideoSize,
  spreadPositions,
  buildImagePayload,
  buildVideoPayload,
  buildTextPayload,
  buildPastedTextPayload,
  DEFAULT_VIDEO_SIZE,
  MAX_TEXT_LENGTH,
} from '../fileDropEngine'

function file(name: string, type = ''): { name: string; type: string } {
  return { name, type }
}

describe('classifyFile（ext/mime → 类型）', () => {
  it('image：按 mime（image/*）与扩展名（png/jpg/gif/webp/svg/bmp/ico）', () => {
    expect(classifyFile(file('a.png', 'image/png'))).toBe('image')
    expect(classifyFile(file('b', 'image/jpeg'))).toBe('image')
    expect(classifyFile(file('c.svg'))).toBe('image')
    expect(classifyFile(file('d.JPG'))).toBe('image')
    expect(classifyFile(file('e.webp', 'image/webp'))).toBe('image')
  })

  it('text：按 mime（text/plain|markdown|x-markdown）与扩展名（txt/md/markdown）', () => {
    expect(classifyFile(file('a.txt', 'text/plain'))).toBe('text')
    expect(classifyFile(file('b.md'))).toBe('text')
    expect(classifyFile(file('c.MARKDOWN', 'text/x-markdown'))).toBe('text')
  })

  it('video：按 mime（video/*）与扩展名（mp4/webm/ogg/mov/avi/mkv/wmv）', () => {
    expect(classifyFile(file('v.mp4', 'video/mp4'))).toBe('video')
    expect(classifyFile(file('v.webm'))).toBe('video')
    expect(classifyFile(file('v.MOV', 'video/quicktime'))).toBe('video')
    expect(classifyFile(file('v.mkv'))).toBe('video')
  })

  it('未知 → unsupported', () => {
    expect(classifyFile(file('x.bin', 'application/octet-stream'))).toBe('unsupported')
    expect(classifyFile(file('noext'))).toBe('unsupported')
    // 音频不是视频：v2 没有音频节点，不给它建节点
    expect(classifyFile(file('a.mp3', 'audio/mpeg'))).toBe('unsupported')
  })
})

describe('clampText（超长截断）', () => {
  it('短文本原样返回', () => {
    expect(clampText('hello')).toBe('hello')
  })

  it('超长文本截断到 MAX_TEXT_LENGTH 并带提示', () => {
    const long = 'a'.repeat(MAX_TEXT_LENGTH + 100)
    const out = clampText(long)
    expect(out.startsWith('a'.repeat(MAX_TEXT_LENGTH))).toBe(true)
    expect(out).toContain('内容过长')
    expect(out).toContain(String(long.length))
    expect(out.length).toBeLessThan(long.length)
  })

  it('自定义上限', () => {
    const out = clampText('123456', 3)
    expect(out.startsWith('123')).toBe(true)
    expect(out).toContain('内容过长')
  })
})

describe('fitImageSize（图片卡片适配）', () => {
  it('小图不放大（ratio 上限 1）', () => {
    expect(fitImageSize({ width: 100, height: 50 })).toEqual({ w: 120, h: 80 })
  })

  it('大图等比缩到卡片内，不超上限、不低于下限', () => {
    // 2000x1000 → ratio = min(420/2000, 300/1000, 1) = 0.21 → 420x210
    expect(fitImageSize({ width: 2000, height: 1000 })).toEqual({ w: 420, h: 210 })
  })

  it('非法尺寸退回默认卡片', () => {
    expect(fitImageSize({ width: 0, height: 0 })).toEqual({ w: 420, h: 300 })
  })
})

describe('spreadPositions（多文件级联）', () => {
  it('单文件即中心点', () => {
    expect(spreadPositions({ x: 100, y: 100 }, 1)).toEqual([{ x: 100, y: 100 }])
  })

  it('多文件从中心级联排布（步进 gap=40）', () => {
    const positions = spreadPositions({ x: 200, y: 200 }, 2)
    expect(positions.length).toBe(2)
    expect(positions[1].x - positions[0].x).toBe(40)
    expect(positions[1].y - positions[0].y).toBe(40)
    // 中心在第 0/1 之间（baseX = 200 - 2*10 = 180；p0=180, p1=220 → 中心 200）
    expect(positions[0].x).toBe(180)
    expect(positions[1].x).toBe(220)
  })

  it('count 0 返回空', () => {
    expect(spreadPositions({ x: 0, y: 0 }, 0)).toEqual([])
  })
})

describe('payload 构建', () => {
  it('buildImagePayload：带 objectURL 与尺寸（有真实尺寸走适配 size）', () => {
    const p = buildImagePayload(file('pic.png', 'image/png'), 'blob:url1', { x: 10, y: 20 }, { width: 2000, height: 1000 })
    expect(p.type).toBe('image')
    expect(p.position).toEqual({ x: 10, y: 20 })
    expect(p.data.imageUrl).toBe('blob:url1')
    expect(p.data.imageName).toBe('pic.png')
    expect(p.data.imageType).toBe('image/png')
    expect(p.data.imageWidth).toBe(2000)
    expect(p.data.imageHeight).toBe(1000)
    expect(p.size).toEqual({ w: 420, h: 210 })
  })

  it('buildImagePayload：无真实尺寸退回默认卡片', () => {
    const p = buildImagePayload(file('pic.png', 'image/png'), 'blob:url1', { x: 0, y: 0 }, null)
    expect(p.size).toEqual({ w: 420, h: 300 })
    expect(p.data.imageWidth).toBeUndefined()
  })

  it('buildTextPayload：文本节点 data.text + label 文件名', () => {
    const p = buildTextPayload(file('note.md'), 'hello', { x: 1, y: 2 })
    expect(p.type).toBe('text')
    expect(p.data).toEqual({ text: 'hello', label: 'note.md' })
    expect(p.size).toBeUndefined()
  })

  it('buildPastedTextPayload：粘贴文本 data.text', () => {
    const p = buildPastedTextPayload('clip', { x: 3, y: 4 })
    expect(p.data).toEqual({ text: 'clip', label: '粘贴的文本' })
  })
})

describe('fitVideoSize（视频卡片适配）', () => {
  it('大视频等比缩到 560×360 内，不超上限、不低于下限', () => {
    // 1280×720: min(560/1280, 360/720, 1) = 0.4375 → 560×315
    expect(fitVideoSize({ width: 1280, height: 720 })).toEqual({ w: 560, h: 315 })
  })

  it('小视频不放大（ratio 上限 1）', () => {
    expect(fitVideoSize({ width: 320, height: 240 })).toEqual({ w: 320, h: 240 })
  })

  it('非法尺寸退回默认卡片', () => {
    expect(fitVideoSize({ width: 0, height: 0 })).toEqual({ w: 560, h: 360 })
  })

  it('封顶与 plugin-node-video 的 560×360 一致（拖进来与在节点里上传必须同尺寸）', () => {
    expect(DEFAULT_VIDEO_SIZE).toEqual({ cardWidth: 560, cardHeight: 360 })
  })
})

describe('buildVideoPayload', () => {
  it('带 objectURL 与元数据（宽高时长 + 适配 size）', () => {
    const p = buildVideoPayload(file('clip.mp4', 'video/mp4'), 'blob:vid1', { x: 7, y: 8 }, {
      width: 1280,
      height: 720,
      duration: 12.4,
    })
    expect(p.type).toBe('video')
    expect(p.position).toEqual({ x: 7, y: 8 })
    expect(p.data.videoUrl).toBe('blob:vid1')
    expect(p.data.videoName).toBe('clip.mp4')
    expect(p.data.videoType).toBe('video/mp4')
    expect(p.data.videoWidth).toBe(1280)
    expect(p.data.videoHeight).toBe(720)
    // 时长取整到秒（与老版 Math.round 一致）
    expect(p.data.videoDuration).toBe(12)
    expect(p.data.cardWidth).toBe(560)
    expect(p.data.cardHeight).toBe(315)
    expect(p.size).toEqual({ w: 560, h: 315 })
  })

  it('读不到元数据 → 默认卡片尺寸且不写尺寸字段（不猜）', () => {
    const p = buildVideoPayload(file('clip.mp4'), 'blob:vid1', { x: 0, y: 0 }, null)
    expect(p.size).toEqual({ w: 560, h: 360 })
    expect(p.data.cardWidth).toBe(560)
    expect(p.data.videoWidth).toBeUndefined()
    expect(p.data.videoDuration).toBeUndefined()
  })

  it('字段名与 plugin-node-video 的 data 约定逐字一致（否则状态栏/裁剪读不到值）', () => {
    const p = buildVideoPayload(file('clip.mp4'), 'blob:vid1', { x: 0, y: 0 }, null)
    for (const key of ['videoUrl', 'videoName', 'cardWidth', 'cardHeight']) {
      expect(Object.prototype.hasOwnProperty.call(p.data, key)).toBe(true)
    }
  })
})
