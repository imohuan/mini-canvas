/**
 * catalog 单测 —— 清单与 Config schema 的**一致性契约**（不漂移）。
 */
import { describe, it, expect } from 'vitest'
import {
  Config, DEFAULTS, CURSORS, CURSOR_GROUPS, FOLLOWS, EFFECTS, CURSOR_NAV_ID,
  CUSTOM_CURSOR_ID, cursorById, isAnimatedCursor, cursorEffectConfigFrom, type SettingsLike,
} from '../catalog'
import { COLOR_ASSETS } from '../colorAssets'
import { ICONS } from '../icons'

describe('Config schema', () => {
  it('全部字段都登记在同一个扁平分组「光标」下', () => {
    for (const [k, f] of Object.entries(Config)) expect((f as { group?: string }).group, k).toBe(CURSOR_NAV_ID)
  })
  it('select 选项与清单一一对齐', () => {
    const ids = (k: keyof typeof Config) => {
      const opts = (Config[k] as { options?: Array<string | { value: string }> }).options ?? []
      return opts.map((o) => (typeof o === 'string' ? o : o.value))
    }
    expect(ids('cursorFxCursor')).toEqual([...CURSORS.map((c) => c.id), CUSTOM_CURSOR_ID])
    expect(ids('cursorFxFollow')).toEqual(FOLLOWS.map((f) => f.id))
    expect(ids('cursorFxEffect')).toEqual(EFFECTS.map((e) => e.id))
  })
  it('DEFAULTS 覆盖每个键、类型一致', () => {
    expect(Object.keys(DEFAULTS).sort()).toEqual(Object.keys(Config).sort())
    for (const [k, f] of Object.entries(Config)) expect(typeof (DEFAULTS as Record<string, unknown>)[k], k).toBe(typeof f.default)
  })
  it('默认光标/跟随/特效都是合法 id', () => {
    expect(CURSORS.some((c) => c.id === DEFAULTS.cursorFxCursor)).toBe(true)
    expect(FOLLOWS.some((f) => f.id === DEFAULTS.cursorFxFollow)).toBe(true)
    expect(EFFECTS.some((e) => e.id === DEFAULTS.cursorFxEffect)).toBe(true)
  })
  it('光标分类页签合起来覆盖全部光标', () => {
    expect(CURSOR_GROUPS.flatMap((g) => g.items)).toEqual(CURSORS)
  })
})

describe('素材完整性（防"渲染成方块"）', () => {
  it('每个光标/跟随/特效引用的素材键都真实存在', () => {
    const missing: string[] = []
    const check = (key: string, src: string) => {
      const ok = src === 'color' ? !!COLOR_ASSETS[key] : !!ICONS[key]
      if (!ok) missing.push(src + ':' + key)
    }
    for (const c of CURSORS) check(c.icon, c.src)
    for (const f of FOLLOWS) check(f.icon, f.src)
    for (const e of EFFECTS) check(e.icon, e.src)
    expect(missing).toEqual([])
  })
  it('彩色素材（真实下载）都在，且是完整 svg', () => {
    for (const k of ['leaf', 'maple', 'blossom', 'star', 'heart', 'snow', 'sparkles', 'glow-star', 'confetti', 'butterfly', 'paw', 'music']) {
      expect(COLOR_ASSETS[k], k).toBeTruthy()
      expect(COLOR_ASSETS[k].startsWith('<svg')).toBe(true)
      expect(COLOR_ASSETS[k].endsWith('</svg>')).toBe(true)
    }
    expect(Object.keys(COLOR_ASSETS).length).toBeGreaterThanOrEqual(28)
  })
  it('单色指针素材都在（真鼠标形状）', () => {
    for (const k of ['pointer-arrow', 'pointer-triangle', 'hand-point', 'crosshair', 'text-i', 'move', 'help', 'target']) {
      expect(ICONS[k], k).toBeTruthy()
    }
  })
})

describe('cursorById / isAnimatedCursor', () => {
  it('查不到回落第一个', () => { expect(cursorById('nope')).toBe(CURSORS[0]) })
  it('只有图标款(kind=dom)算"会动"', () => {
    expect(isAnimatedCursor('arrow')).toBe(true)
    expect(isAnimatedCursor('sys-pointer')).toBe(false)
    expect(isAnimatedCursor('img-white')).toBe(false)
  })
})

describe('cursorEffectConfigFrom', () => {
  const fake = (m: Record<string, unknown>): SettingsLike => ({ get: (k) => m[k], onChange: () => ({ dispose: () => {} }) })
  it('settings 缺失 → 全默认', () => {
    expect(cursorEffectConfigFrom({ tryGet: <T,>() => undefined as T | undefined })).toEqual(DEFAULTS)
  })
  it('有值优先，缺项回落默认', () => {
    const cfg = cursorEffectConfigFrom({ tryGet: <T,>() => fake({ cursorFxCursor: 'c-star' }) as unknown as T | undefined })
    expect(cfg.cursorFxCursor).toBe('c-star')
    expect(cfg.cursorFxFollow).toBe(DEFAULTS.cursorFxFollow)
  })
})
