/**
 * 节点加载态分档（纯函数，Node 直接跑）。
 *
 * 用户口径 2026-11-08：加载态要按档位显示不同 UI，并做成全局通用配置。
 * 这里钉住三件事：
 * 1. 三档判定与阈值顺序（第三档阈值配错时夹到不超过第二档）；
 * 2. 缩到画布最小缩放必定进第三档（"第三档够得着"的兜底）；
 * 3. 脏数据一律回落第 1 档，不抛、不黑屏。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_NODE_LOADING_TIERS,
  NODE_LOADING_TIER_PREFIX,
  nodeLoadingTierFields,
  nodeLoadingTierKeys,
  resolveNodeLoadingTier,
  resolveNodeLoadingTiers,
} from './nodeLoadingTier'

describe('resolveNodeLoadingTier：三档', () => {
  it('放大 / 常规缩放 → 第 1 档（完整）', () => {
    expect(resolveNodeLoadingTier(1)).toBe(1)
    expect(resolveNodeLoadingTier(0.8)).toBe(1)
    expect(resolveNodeLoadingTier(DEFAULT_NODE_LOADING_TIERS.tier2Zoom)).toBe(1)
  })

  it('介于两档阈值之间 → 第 2 档（精简）', () => {
    expect(resolveNodeLoadingTier(0.5)).toBe(2)
    expect(resolveNodeLoadingTier(0.4)).toBe(2)
  })

  it('低于第三档阈值 → 第 3 档（极简）', () => {
    expect(resolveNodeLoadingTier(0.3)).toBe(3)
    expect(resolveNodeLoadingTier(0.1)).toBe(3)
  })

  it('★ 缩到画布最小缩放必定进第 3 档（阈值配得再小也兜底）', () => {
    expect(resolveNodeLoadingTier(0.2, DEFAULT_NODE_LOADING_TIERS, 0.2)).toBe(3)
    // 阈值配成 0.01 也要够得着
    expect(resolveNodeLoadingTier(0.05, { tier2Zoom: 0.02, tier3Zoom: 0.01 }, 0.05)).toBe(3)
  })

  it('脏数据（NaN / Infinity / 0 / 负数 / 缺失）→ 第 1 档，不抛', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, undefined, null, 'x']) {
      expect(resolveNodeLoadingTier(bad)).toBe(1)
    }
  })
})

describe('resolveNodeLoadingTiers：阈值解析', () => {
  it('用户配了什么就用什么', () => {
    const cfg = resolveNodeLoadingTiers(NODE_LOADING_TIER_PREFIX, (key) =>
      key.endsWith('Tier2Zoom') ? 0.7 : 0.4,
    )
    expect(cfg).toEqual({ tier2Zoom: 0.7, tier3Zoom: 0.4 })
  })

  it('第三档阈值大于第二档 → 夹到不超过第二档（配置写错也确定）', () => {
    const cfg = resolveNodeLoadingTiers(NODE_LOADING_TIER_PREFIX, (key) =>
      key.endsWith('Tier2Zoom') ? 0.3 : 0.9,
    )
    expect(cfg.tier3Zoom).toBeLessThanOrEqual(cfg.tier2Zoom)
  })

  it('脏值各自回落默认，不影响另一项', () => {
    const cfg = resolveNodeLoadingTiers(NODE_LOADING_TIER_PREFIX, (key) =>
      key.endsWith('Tier2Zoom') ? Number.NaN : 0.4,
    )
    expect(cfg.tier2Zoom).toBe(DEFAULT_NODE_LOADING_TIERS.tier2Zoom)
    expect(cfg.tier3Zoom).toBe(0.4)
  })
})

describe('设置字段', () => {
  it('两项字段键名带前缀（settings 全局同一张表，撞名会被静默跳过）', () => {
    const fields = nodeLoadingTierFields(NODE_LOADING_TIER_PREFIX, '常规/节点加载态')
    expect(Object.keys(fields).sort()).toEqual(nodeLoadingTierKeys(NODE_LOADING_TIER_PREFIX).sort())
    for (const key of Object.keys(fields)) {
      expect(key.startsWith(NODE_LOADING_TIER_PREFIX)).toBe(true)
    }
  })

  it('默认值与纯函数默认一致（面板显示的就是实际生效值）', () => {
    const fields = nodeLoadingTierFields(NODE_LOADING_TIER_PREFIX, 'g')
    expect(fields[NODE_LOADING_TIER_PREFIX + 'Tier2Zoom'].default).toBe(
      DEFAULT_NODE_LOADING_TIERS.tier2Zoom,
    )
    expect(fields[NODE_LOADING_TIER_PREFIX + 'Tier3Zoom'].default).toBe(
      DEFAULT_NODE_LOADING_TIERS.tier3Zoom,
    )
  })
})
