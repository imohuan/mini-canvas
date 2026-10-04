/**
 * engine —— 光标特效的**纯逻辑**（零 Vue、零 DOM 依赖，Node 可单测）。
 *
 * 三件事：
 * 1. 图标 → SVG 字符串 / data URI（优先用**真实彩色素材**，没有才回落单色线框）；
 * 2. 透明光标占位图（1x1 透明 PNG）—— 把**原生指针藏掉**，鼠标交给跟随元素；
 * 3. 点击特效的**粒子配方** spawnSpec()：给类型/坐标/强度/尺寸，产出这一炸的粒子与光圈描述。
 *    渲染（canvas 逐帧画）留在 overlay 组件里，本文件只算"该生成什么"，于是可脱离浏览器测。
 */
import { ICONS } from './icons'
import { COLOR_ASSETS } from './colorAssets'
import type { EffectId } from './catalog'

/**
 * 取图标 SVG 字符串。
 * @param color 传了就按单色处理（把 currentColor 换掉）；不传且该键有**真实彩色素材**时，用彩色素材原样。
 */
export function svgIcon(name: string, size?: number, color?: string): string {
  let s: string
  if (!color && COLOR_ASSETS[name]) {
    s = COLOR_ASSETS[name]
  } else {
    s = ICONS[name] ?? ''
    if (color) s = s.replace(/currentColor/g, color)
  }
  if (size) {
    s = s.replace(/width="[^"]*"/, 'width="' + size + '"').replace(/height="[^"]*"/, 'height="' + size + '"')
    if (!/width="/.test(s)) s = s.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ')
  }
  return s
}

/** SVG 字符串 → data URI（可直接给 <img src> / cursor:url）。 */
export function dataUri(svg: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

/** 该键是否有真实彩色素材。 */
export function hasColorAsset(name: string): boolean {
  return !!COLOR_ASSETS[name]
}

/** 1x1 全透明 PNG。用于 `cursor:url(<此图>), none` 把原生指针藏掉。 */
export const TRANSPARENT_CURSOR =
  'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=") 0 0, none'

/** 粒子（canvas 逐帧画） */
export interface Particle {
  /** sp = 光点精灵；ic = 图标精灵（真实素材）；txt = 文字 */
  k: 'sp' | 'ic' | 'txt'
  x: number; y: number
  vx: number; vy: number
  g: number
  life: number
  dec: number
  size: number
  hue?: number
  /** 图标名 / 文字内容 */
  n?: string
  col?: string
  rot?: number
  vr?: number
}

/** 光圈（扩散环） */
export interface Ring {
  x: number; y: number
  r: number
  max: number
  a: number
  w: number
  hue: number
  delay: number
}

export interface SpawnSpec {
  particles: Particle[]
  rings: Ring[]
}

export type Rand = () => number

export interface SpawnOptions {
  /** 粒子大小基准（来自「特效大小」配置，默认 22） */
  size?: number
  rand?: Rand
}

/**
 * 派发一次点击特效的粒子配方。
 * @param type  特效 id
 * @param x,y   屏幕（client）坐标
 * @param power 强度（1 = 标准；来自配置 特效强度/90）
 */
export function spawnSpec(type: EffectId, x: number, y: number, power: number, opts: SpawnOptions = {}): SpawnSpec {
  const rand = opts.rand ?? Math.random
  const base = Math.max(8, opts.size ?? 22)
  const particles: Particle[] = []
  const rings: Ring[] = []
  const rnd = (a: number, b: number) => a + rand() * (b - a)
  const pw = Math.max(0.2, power)
  const n = Math.max(1, Math.round(rnd(12, 20) * Math.min(2, pw)))
  const push = (p: Particle) => particles.push(p)
  /** 抛一个"真实素材"粒子 */
  const icon = (name: string, sizeK: number, spread: number, gravity = 0.03, col?: string) => {
    const a = rnd(0, Math.PI * 2); const s = rnd(0.8, spread)
    push({ k: 'ic', n: name, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - (gravity > 0.05 ? 0 : 1), g: gravity, life: 1, dec: rnd(0.008, 0.016), size: base * sizeK * rnd(0.8, 1.2), rot: rnd(0, 6.28), vr: rnd(-0.08, 0.08), col })
  }

  switch (type) {
    case 'fireworks': {
      const hue = rand() * 360
      rings.push({ x, y, r: 6, max: 52 * pw, a: 1, w: 2.4, hue, delay: 0 })
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n + rnd(-0.12, 0.12)
        const sp = rnd(1.6, 5)
        push({ k: 'sp', x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 0.055, life: 1, dec: rnd(0.012, 0.022), size: rnd(6, 11) * pw, hue: hue / 10 + rnd(-3, 3) })
      }
      for (let i = 0; i < Math.max(2, Math.round(4 * pw)); i++) icon('sparkles', 1.1, 3.4, 0.05)
      break
    }
    case 'sparkle': {
      for (let i = 0; i < n; i++) icon('glow-star', 1, 3.6, 0.02)
      icon('dizzy', 1.3, 1.2, 0.02)
      break
    }
    case 'confetti': {
      for (let i = 0; i < n; i++) icon(rand() < 0.5 ? 'confetti' : 'candy', 0.9, 4.4, 0.1)
      break
    }
    case 'hearts': {
      for (let i = 0; i < n; i++) icon(rand() < 0.5 ? 'heart' : 'heart-pink', 1.0, 2.6, 0.03)
      break
    }
    case 'flowers': {
      const kinds = ['blossom', 'hibiscus', 'sunflower']
      for (let i = 0; i < n; i++) icon(kinds[Math.floor(rand() * kinds.length)], 1.0, 3.0, 0.02)
      break
    }
    case 'snowburst': {
      for (let i = 0; i < n; i++) icon('snow', 1.0, 3.2, 0.02)
      break
    }
    case 'music': {
      for (let i = 0; i < n; i++) icon('music', 1.1, 2.6, 0.02)
      break
    }
    case 'ripple': {
      for (let r = 0; r < 3; r++) rings.push({ x, y, r: 4 + r * 6, max: 44 + r * 22, a: 1, w: 2.6 - r * 0.5, hue: 19 + r, delay: r * 4 })
      break
    }
    case 'shockwave': {
      rings.push({ x, y, r: 4, max: 96, a: 1, w: 3.4, hue: 19, delay: 0 })
      rings.push({ x, y, r: 4, max: 62, a: 1, w: 2, hue: 30, delay: 2 })
  for (let i = 0; i < Math.max(3, Math.round(5 * pw)); i++) icon('bolt', 1.0, 4.0, 0.04, '#fbbf24') // 主题色白名单: 闪电特效固定琥珀色，装饰用色
      break
    }
    case 'none':
    default:
      break
  }
  return { particles, rings }
}

/** 把新粒子并入数组，**带容量上限**（护帧率：超过就丢最老的）。 */
export function pushWithin(arr: Particle[], incoming: Particle[], cap: number): Particle[] {
  for (const p of incoming) arr.push(p)
  const overflow = arr.length - Math.max(1, cap)
  if (overflow > 0) arr.splice(0, overflow)
  return arr
}

/** 推进粒子一帧（就地改）；返回存活的粒子数组。 */
export function stepParticles(parts: Particle[], dt: number): Particle[] {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    p.vy += p.g * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= 0.99
    p.vy *= 0.99
    p.life -= p.dec * dt
    if (p.rot !== undefined) p.rot += (p.vr ?? 0) * dt
    if (p.life <= 0) parts.splice(i, 1)
  }
  return parts
}

/** 推进光圈一帧（就地改）；返回存活的光圈数组。 */
export function stepRings(rings: Ring[], dt: number): Ring[] {
  for (let i = rings.length - 1; i >= 0; i--) {
    const g = rings[i]
    if (g.delay > 0) { g.delay -= dt; continue }
    g.r += (g.max - g.r) * 0.12 * dt
    g.a *= Math.pow(0.93, dt)
    if (g.a < 0.03) rings.splice(i, 1)
  }
  return rings
}
