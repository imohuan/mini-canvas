import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYGROUND, PLAYGROUND_PRESETS, summarize } from './playground'

describe('预览页配置', () => {
  it('默认摘要写出外观与尺寸', () => {
    expect(summarize(DEFAULT_PLAYGROUND)).toBe('主要 · 中 · 带图标')
  })

  it('纯图标时不重复说带图标', () => {
    const text = summarize({ ...DEFAULT_PLAYGROUND, label: '更多', iconOnly: true })
    expect(text).toContain('纯图标')
    expect(text).not.toContain('带图标')
  })

  it('每个预设都能套用并给出可读摘要', () => {
    for (const preset of PLAYGROUND_PRESETS) {
      const state = { ...DEFAULT_PLAYGROUND, ...preset.patch }
      expect(summarize(state).length).toBeGreaterThan(0)
    }
  })
})
