/**
 * engine 单测 —— 纯逻辑（粒子配方 / 帧推进 / 图标 → SVG 含彩色素材）。
 */
import { describe, it, expect } from 'vitest'
import { spawnSpec, pushWithin, stepParticles, stepRings, svgIcon, dataUri, hasColorAsset, TRANSPARENT_CURSOR, type Particle } from '../engine'
import { COLOR_ASSETS } from '../colorAssets'

const fixed = (v: number) => () => v

describe('spawnSpec：点击特效的粒子配方（真实素材）', () => {
  it('烟花：光点 + 光圈 + 火花素材', () => {
    const s = spawnSpec('fireworks', 12, 34, 1, { rand: fixed(0.5), size: 22 })
    expect(s.particles.some((p) => p.k === 'sp')).toBe(true)
    expect(s.particles.some((p) => p.k === 'ic' && p.n === 'sparkles')).toBe(true)
    expect(s.rings).toHaveLength(1)
    expect(s.rings[0]).toMatchObject({ x: 12, y: 34 })
  })
  it('每个"素材型"特效都产出图标粒子，且素材键真实存在', () => {
    for (const t of ['sparkle', 'confetti', 'hearts', 'flowers', 'snowburst', 'music', 'shockwave'] as const) {
      const s = spawnSpec(t, 0, 0, 1, { rand: fixed(0.3), size: 22 })
      const icons = s.particles.filter((p) => p.k === 'ic')
      expect(icons.length, t).toBeGreaterThan(0)
      for (const p of icons) expect(COLOR_ASSETS[p.n as string] || p.n === 'bolt', t + ':' + p.n).toBeTruthy()
    }
  })
  it('涟漪 / 冲击波含光圈；none 无产出', () => {
    expect(spawnSpec('ripple', 0, 0, 1, { rand: fixed(.5) }).rings.length).toBeGreaterThan(0)
    expect(spawnSpec('shockwave', 0, 0, 1, { rand: fixed(.5) }).rings).toHaveLength(2)
    expect(spawnSpec('none', 0, 0, 1, { rand: fixed(.5) }).particles).toHaveLength(0)
  })
  it('强度越高粒子越多', () => {
    const lo = spawnSpec('hearts', 0, 0, 0.5, { rand: fixed(0.9), size: 22 }).particles.length
    const hi = spawnSpec('hearts', 0, 0, 2, { rand: fixed(0.9), size: 22 }).particles.length
    expect(hi).toBeGreaterThan(lo)
  })
  it('特效大小随 size 缩放', () => {
    const small = spawnSpec('hearts', 0, 0, 1, { rand: fixed(0.5), size: 10 }).particles[0].size
    const big = spawnSpec('hearts', 0, 0, 1, { rand: fixed(0.5), size: 40 }).particles[0].size
    expect(big).toBeGreaterThan(small)
  })
})

describe('pushWithin：容量上限', () => {
  const mk = (n: number): Particle[] => Array.from({ length: n }, (_, i) => ({ k: 'sp', x: i, y: 0, vx: 0, vy: 0, g: 0, life: 1, dec: 0.01, size: 1, hue: i }))
  it('超上限丢最老的', () => { const a: Particle[] = []; pushWithin(a, mk(100), 10); expect(a).toHaveLength(10); expect(a[0].hue).toBe(90) })
  it('cap>=1', () => { const a: Particle[] = []; pushWithin(a, mk(3), 0); expect(a).toHaveLength(1) })
})

describe('stepParticles / stepRings', () => {
  it('生命归零移除', () => { const p: Particle[] = [{ k: 'sp', x: 0, y: 0, vx: 1, vy: 0, g: 0, life: .05, dec: .1, size: 1 }]; stepParticles(p, 1); expect(p).toHaveLength(0) })
  it('速度与重力', () => { const p: Particle[] = [{ k: 'sp', x: 0, y: 0, vx: 2, vy: 0, g: 1, life: 1, dec: .001, size: 1 }]; stepParticles(p, 1); expect(p[0].x).toBeCloseTo(2, 5); expect(p[0].vy).toBeCloseTo(.99, 5) })
  it('光圈 delay 后扩散、淡化后移除', () => {
    const r = [{ x: 0, y: 0, r: 4, max: 100, a: 1, w: 2, hue: 1, delay: 3 }]
    stepRings(r, 1); expect(r[0].r).toBe(4)
    stepRings(r, 1); stepRings(r, 1); stepRings(r, 1); expect(r[0].r).toBeGreaterThan(4)
  })
})

describe('svgIcon / 素材', () => {
  it('彩色素材：不传 color 时原样返回（含自带颜色）', () => {
    const out = svgIcon('leaf')
    expect(out).toContain('</svg>')
    expect(hasColorAsset('leaf')).toBe(true)
    expect(out).toBe(COLOR_ASSETS['leaf'])
  })
  it('单色图标：传 color 时替换 currentColor 与尺寸', () => {
    const out = svgIcon('pointer-arrow', 40, '#ff0000')
    expect(out).toContain('#ff0000')
    expect(out).not.toContain('currentColor')
    expect(out).toContain('width="40"')
  })
  it('未知键返回空串（不抛）', () => { expect(svgIcon('__nope__')).toBe('') })
  it('dataUri 可用', () => { expect(dataUri('<svg/>').startsWith('data:image/svg+xml;utf8,')).toBe(true) })
  it('透明光标是 png + none 兜底', () => { expect(TRANSPARENT_CURSOR).toContain('url("data:image/png;base64,'); expect(TRANSPARENT_CURSOR.trim().endsWith('none')).toBe(true) })
})

