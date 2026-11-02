import { describe, expect, it } from 'vitest'
import { buildGuideLine, isSvgPath, nearestEdgePoint } from './guide'

const chip = { x: 0, y: 100, w: 120, h: 44 }
const target = { x: 300, y: 160, w: 200, h: 120 }

describe('theme lab 指示线', () => {
  it('左栏的色块从右边缘出发，终点落在目标左侧（留出呼吸距离）', () => {
    const line = buildGuideLine(chip, target)
    expect(line.side).toBe('right')
    expect(line.start).toEqual({ x: 120, y: 122 })
    expect(line.end.y).toBe(220)
    expect(line.end.x).toBeLessThan(target.x + target.w)
    expect(line.end.x).toBeGreaterThanOrEqual(target.x)
  })

  it('起点和终点相同时不会画出一条折返线（至少有一段弯曲）', () => {
    const line = buildGuideLine({ x: 300, y: 300, w: 100, h: 40 }, target)
    expect(line.d.length).toBeGreaterThan(20)
    expect(line.c1).not.toEqual(line.end)
  })

  it('最近边沿按距离选择，不依赖调用顺序', () => {
    expect(nearestEdgePoint({ x: 100, y: 100, w: 100, h: 100 }, { x: 400, y: 150 }).side).toBe('right')
    expect(nearestEdgePoint({ x: 100, y: 100, w: 100, h: 100 }, { x: 150, y: -100 }).side).toBe('top')
  })
})

describe('isSvgPath', () => {
  it('按命名空间与标签名识别 SVG path，而不是只认某个 realm 的构造函数', () => {
    const fakePath = {
      namespaceURI: 'http://www.w3.org/2000/svg',
      tagName: 'path',
    } as unknown as Element
    expect(isSvgPath(fakePath)).toBe(true)
  })

  it('普通 HTML 元素与 SVG 里的其它图形不会被当成路径', () => {
    const div = { namespaceURI: 'http://www.w3.org/1999/xhtml', tagName: 'DIV' } as unknown as Element
    const circle = { namespaceURI: 'http://www.w3.org/2000/svg', tagName: 'circle' } as unknown as Element
    expect(isSvgPath(div)).toBe(false)
    expect(isSvgPath(circle)).toBe(false)
  })
})
