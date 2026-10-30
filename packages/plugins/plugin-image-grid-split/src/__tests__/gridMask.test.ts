import { describe, it, expect } from 'vitest'
import { gridMaskUri, roundedRectPath, type MaskCell } from '../gridMask'

const cell = (over: Partial<MaskCell> = {}): MaskCell => ({
  x: 0, y: 0, w: 100, h: 100, tl: 0, tr: 0, br: 0, bl: 0, ...over,
})

describe('roundedRectPath：逐角圆角', () => {
  it('全直角：只有直线段，没有弧线命令', () => {
    const d = roundedRectPath(cell())
    expect(d).not.toContain('A')
    expect(d.startsWith('M0,0')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('只有左上圆角：弧线出现一次，且在左上角', () => {
    const d = roundedRectPath(cell({ tl: 12 }))
    expect((d.match(/A/g) ?? []).length).toBe(1)
    expect(d).toContain('A12,12 0 0 1 12,0')
  })

  it('四角各自圆角：四条弧线', () => {
    const d = roundedRectPath(cell({ tl: 8, tr: 8, br: 8, bl: 8 }))
    expect((d.match(/A/g) ?? []).length).toBe(4)
  })

  it('半径超过半宽/半高时被夹住（不自交）', () => {
    const d = roundedRectPath(cell({ w: 40, h: 20, tl: 999, tr: 999, br: 999, bl: 999 }))
    // 夹到 min(40,20)/2 = 10
    expect(d).toContain('A10,10')
    expect(d).not.toContain('A999')
  })
})

describe('gridMaskUri：抠除遮罩', () => {
  it('黑底 + 白色格子（白=保留，黑=抠掉）', () => {
    const uri = gridMaskUri([cell()], 480, 360)
    expect(uri.startsWith('url("data:image/svg+xml,')).toBe(true)
    const svg = decodeURIComponent(uri.slice('url("data:image/svg+xml,'.length, -2))
    expect(svg).toContain('fill="#000"')
    expect(svg).toContain('fill="#fff"')
    expect(svg).toContain('width="480"')
    expect(svg).toContain('height="360"')
  })

  it('多格：每格一条 path（缝隙 = 没被白格覆盖的黑底）', () => {
    const cells = [cell({ x: 0, y: 0 }), cell({ x: 110, y: 0 }), cell({ x: 0, y: 110 })]
    const uri = gridMaskUri(cells, 300, 300)
    const svg = decodeURIComponent(uri.slice('url("data:image/svg+xml,'.length, -2))
    expect((svg.match(/<path/g) ?? []).length).toBe(3)
  })

  it('空表 / 非法尺寸返回空串（调用方据此不加遮罩）', () => {
    expect(gridMaskUri([], 480, 360)).toBe('')
    expect(gridMaskUri([cell()], 0, 360)).toBe('')
    expect(gridMaskUri([cell()], 480, Number.NaN)).toBe('')
  })
})
