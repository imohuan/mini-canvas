import { describe, expect, it } from 'vitest'
import {
  classifyFile,
  clampText,
  fitImageSize,
  spreadPositions,
  buildImagePayload,
  buildTextPayload,
  buildPastedTextPayload,
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

  it('视频/未知 → unsupported（v2 无 video 节点）', () => {
    expect(classifyFile(file('v.mp4', 'video/mp4'))).toBe('unsupported')
    expect(classifyFile(file('x.bin', 'application/octet-stream'))).toBe('unsupported')
    expect(classifyFile(file('noext'))).toBe('unsupported')
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
