/**
 * 渲染清晰度分档（对照图片插件 thumbTier 的同一套规则）。
 *
 * 用户 2026-10-17 的要求：像图片插件那样按画布缩放分档，每档显示多大（倍数）可配，
 * 并且要支持 0.125 / 0.25 / 0.5 这种**缩小**档（省性能）。
 *
 * 这里锁住四条：
 *   1. 三档阈值判定与 minZoom 兜底；
 *   2. 阈值配错时往下夹（tier3 <= tier2），行为仍确定；
 *   3. 倍数只认白名单，脏值回落；
 *   4. 每档取到的就是配置里那一档的倍数。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RASTER_TIERS,
  RASTER_SCALES,
  normalizeRasterScale,
  rasterScaleFor,
  rasterTierKeys,
  readRasterTiers,
  resolveRasterTier,
  resolveRasterTiers,
  rasterTierFields,
} from '../rasterTier'

describe('渲染清晰度分档', () => {
  it('三档判定：缩放越大档位越靠前（越不需要超采样）', () => {
    const cfg = { ...DEFAULT_RASTER_TIERS }
    expect(resolveRasterTier(1.2, cfg)).toBe(1)
    expect(resolveRasterTier(0.4, cfg)).toBe(2)
    expect(resolveRasterTier(0.25, cfg)).toBe(3)
  })

  it('★ 缩到画布最小值必定进第三档（阈值配得再小也够得着）', () => {
    const cfg = { ...DEFAULT_RASTER_TIERS, tier3Zoom: 0.05 }
    expect(resolveRasterTier(0.2, cfg, 0.2)).toBe(3)
  })

  it('阈值配反了往下夹：tier3 不会大于 tier2', () => {
    const cfg = resolveRasterTiers('x', (k) => ({ xTier2Zoom: 0.3, xTier3Zoom: 0.9 } as Record<string, unknown>)[k])
    expect(cfg.tier3Zoom).toBeLessThanOrEqual(cfg.tier2Zoom)
  })

  it('倍数只认白名单，脏值回落（缺失 → 该项默认值）', () => {
    expect(normalizeRasterScale('4')).toBe(4)
    expect(normalizeRasterScale(0.125)).toBe(0.125)
    expect(normalizeRasterScale('abc')).toBe(1)
    expect(normalizeRasterScale(null)).toBe(1)
    expect(RASTER_SCALES).toContain(0.5)
  })

  it('每档取的就是配置里那一档的倍数', () => {
    const cfg = { tier1Scale: 1, tier2Scale: 2, tier3Scale: 0.5, tier2Zoom: 0.45, tier3Zoom: 0.3 }
    expect(rasterScaleFor(1, cfg)).toBe(1)
    expect(rasterScaleFor(2, cfg)).toBe(2)
    expect(rasterScaleFor(3, cfg)).toBe(0.5)
  })

  it('配置字段齐全，键名带前缀（settings 全局同一张表，撞名会被静默跳过）', () => {
    const fields = rasterTierFields('uiNodeRaster', 'G')
    expect(Object.keys(fields).sort()).toEqual(rasterTierKeys('uiNodeRaster').sort())
    for (const k of Object.keys(fields)) expect(k.startsWith('uiNodeRaster')).toBe(true)
  })

  it('非法缩放按第一档处理（宁可正常显示，也不要变糊）', () => {
    expect(resolveRasterTier(NaN)).toBe(1)
    expect(resolveRasterTier(undefined)).toBe(1)
    expect(resolveRasterTier(0)).toBe(1)
  })

  /**
   * 2026-10-17 真实事故：调用方把 settings 对象包成 { get } 传进 readRasterTiers，
   * 于是它内部 ctx.get('settings') 拿到 undefined → 永远读默认值 → 面板里把三档都设成
   * 8 倍，画面依旧一点样式都没有（用户截图：iframe computed 还是 width:100%）。
   *
   * 这条测试钉住「传 ctx 才读得到面板值」，并把错误的传法也钉成默认值（不抛错）。
   */
  it('★ readRasterTiers 必须从 ctx.get(settings) 读面板值', () => {
    const panel = { uiNodeRasterTier1Scale: '8', uiNodeRasterTier2Scale: '4', uiNodeRasterTier3Scale: '2' }
    const settings = { get: (k: string) => (panel as Record<string, unknown>)[k] }
    const ctx = { get: <T,>(name: string): T => (name === 'settings' ? settings : undefined) as T }
    const cfg = readRasterTiers('uiNodeRaster', ctx)
    expect(cfg.tier1Scale).toBe(8)
    expect(cfg.tier2Scale).toBe(4)
    expect(cfg.tier3Scale).toBe(2)

    // 传错（直接把 settings 当 ctx）→ 拿不到面板值，回落默认，且不抛错
    const wrong = readRasterTiers('uiNodeRaster', settings as never)
    expect(wrong.tier1Scale).toBe(DEFAULT_RASTER_TIERS.tier1Scale)
  })
})

