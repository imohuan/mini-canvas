import { describe, expect, it } from 'vitest'
import { calculateFocusZoom, centerViewportOnBounds, clamp } from '../focusViewport'

describe('clamp', () => {
  it('把值夹在 [min,max]', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(20, 0, 10)).toBe(10)
  })
})

describe('calculateFocusZoom', () => {
  it('高度占比决定 zoom：视口高 800，占比 0.5，bounds 高 200 → zoom 2', () => {
    const zoom = calculateFocusZoom({ boundsHeight: 200, viewportHeight: 800, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 })
    expect(zoom).toBeCloseTo(2)
  })
  it('zoom 受 min/max 限制', () => {
    expect(calculateFocusZoom({ boundsHeight: 1, viewportHeight: 100, heightRatio: 0.9, minZoom: 0.1, maxZoom: 1 })).toBe(1)
    expect(calculateFocusZoom({ boundsHeight: 5000, viewportHeight: 100, heightRatio: 0.5, minZoom: 0.1, maxZoom: 4 })).toBeCloseTo(0.1)
  })
})

describe('centerViewportOnBounds', () => {
  it('把 bounds 中心放到视口中心', () => {
    const vp = centerViewportOnBounds({ bounds: { x: 100, y: 200, width: 100, height: 100 }, viewportWidth: 800, viewportHeight: 600, zoom: 1 })
    expect(vp.x).toBeCloseTo(400 - 150)
    expect(vp.y).toBeCloseTo(300 - 250)
    expect(vp.zoom).toBe(1)
  })
})
