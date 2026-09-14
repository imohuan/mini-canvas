import { describe, it, expect } from 'vitest'
import {
  DEFAULT_VIEW,
  LAT_LIMIT,
  FOV_MIN,
  FOV_MAX,
  clampLat,
  clampFov,
  resetView,
  applyDrag,
  applyZoom,
  damp,
  toSpherical,
} from '../panoramaView'

describe('clampLat', () => {
  it('把纬度夹在 ±LAT_LIMIT 内（避免翻到极点）', () => {
    expect(clampLat(120)).toBe(LAT_LIMIT)
    expect(clampLat(-120)).toBe(-LAT_LIMIT)
    expect(clampLat(30)).toBe(30)
  })
})

describe('clampFov', () => {
  it('把视野角夹在 25~90 度', () => {
    expect(clampFov(5)).toBe(FOV_MIN)
    expect(clampFov(200)).toBe(FOV_MAX)
    expect(clampFov(60)).toBe(60)
  })
})

describe('resetView', () => {
  it('重置回默认朝向与默认视野角', () => {
    expect(resetView()).toEqual(DEFAULT_VIEW)
  })
})

describe('applyDrag', () => {
  it('按拖拽位移累加经度/纬度', () => {
    const v = applyDrag(DEFAULT_VIEW, 100, 50)
    expect(v.lon).toBeCloseTo(12)
    expect(v.lat).toBeCloseTo(6)
  })

  it('纵向拖拽到头会被纬度上限挡住', () => {
    expect(applyDrag(DEFAULT_VIEW, 0, 10000).lat).toBe(LAT_LIMIT)
  })

  it('横向拖拽不受限（可绕一整圈）', () => {
    expect(applyDrag(DEFAULT_VIEW, 10000, 0).lon).toBeCloseTo(1200)
  })
})

describe('applyZoom', () => {
  it('滚轮放大缩小视野角并夹在上下限内', () => {
    expect(applyZoom(DEFAULT_VIEW, 100).fov).toBeCloseTo(80)
    expect(applyZoom(DEFAULT_VIEW, -10000).fov).toBe(FOV_MIN)
    expect(applyZoom(DEFAULT_VIEW, 10000).fov).toBe(FOV_MAX)
  })
})

describe('damp', () => {
  it('向目标值靠近一部分（平滑跟随）', () => {
    expect(damp(0, 100, 0.1)).toBeCloseTo(10)
    expect(damp(50, 50, 0.1)).toBe(50)
  })
})

describe('toSpherical', () => {
  it('正前方（lon=0, lat=0）对应 phi=90 度、theta=0', () => {
    const s = toSpherical(0, 0)
    expect(s.phi).toBeCloseTo(Math.PI / 2)
    expect(s.theta).toBeCloseTo(0)
  })

  it('纬度升高 → phi 减小（看向上方）', () => {
    expect(toSpherical(0, 45).phi).toBeCloseTo(Math.PI / 4)
  })

  it('经度 180 度 → theta = PI', () => {
    expect(toSpherical(180, 0).theta).toBeCloseTo(Math.PI)
  })
})
