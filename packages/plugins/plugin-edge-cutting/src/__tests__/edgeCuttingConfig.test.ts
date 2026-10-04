/**
 * 切割颜色的"可选 + 跟随主题"语义（用户要求）：
 * - 轨迹颜色 / 刀锋颜色都可清空（optional），默认留空；
 * - 留空 = 跟随主题：轨迹走强调色悬停档（--ui-accent-hover），刀锋走强调色（--ui-accent）。
 * 这两条一旦被改回"必填固定色"，界面上就再也清不掉、也不会跟随主题，所以用测试钉住。
 */
import { describe, it, expect } from 'vitest'
import type { Context } from '@mini-canvas/canvas-base'
import { Config, edgeCuttingConfigFrom } from '../edgeCuttingConfig'

/** 最小 Context 桩：只有 tryGet('settings')，返回 undefined = settings 未就绪 */
const bareCtx = { tryGet: () => undefined } as unknown as Context

describe('切割颜色 schema', () => {
  it('两格都是 color + optional + 默认留空，且挂在「常规/主题配色」', () => {
    for (const key of ['pathColor', 'bladeColor']) {
      expect(Config[key].type).toBe('color')
      expect(Config[key].optional).toBe(true)
      expect(Config[key].default).toBe('')
      expect(Config[key].group).toBe('常规/主题配色')
    }
  })

  it('描述里写清"清空 = 跟随主题"（用户要求：描述中说明）', () => {
    expect(Config.pathColor.description).toContain('清空 = 跟随主题')
    expect(Config.bladeColor.description).toContain('清空 = 跟随主题')
  })
})

describe('edgeCuttingConfigFrom', () => {
  it('settings 未就绪 → 两色留空（消费方回落主题变量，不是写死色）', () => {
    const cfg = edgeCuttingConfigFrom(bareCtx)
    expect(cfg.pathColor).toBe('')
    expect(cfg.bladeColor).toBe('')
  })

  it('用户设了自定义色 → 原样读出（只有设了才用）', () => {
    const values: Record<string, unknown> = { pathColor: '#ff0063', bladeColor: '#00ff00' }
    const ctx = { tryGet: () => ({ get: (k: string) => values[k] }) } as unknown as Context
    const cfg = edgeCuttingConfigFrom(ctx)
    expect(cfg.pathColor).toBe('#ff0063')
    expect(cfg.bladeColor).toBe('#00ff00')
  })
})
