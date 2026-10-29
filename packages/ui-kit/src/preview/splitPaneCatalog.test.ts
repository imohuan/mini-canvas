import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SPLIT_PANE_STATE,
  SPLIT_PANE_PRESETS,
  buildSplitPaneSnippet,
  splitPaneSummary,
} from './splitPaneCatalog'

describe('SplitPane 展示页配置', () => {
  it('默认值指向一个可用的横向分栏', () => {
    expect(DEFAULT_SPLIT_PANE_STATE.direction).toBe('horizontal')
    expect(DEFAULT_SPLIT_PANE_STATE.initial).toBe(0.5)
  })

  it('纵向预设生成 direction="vertical"', () => {
    const vertical = SPLIT_PANE_PRESETS.find((preset) => preset.id === 'vertical')
    const snippet = buildSplitPaneSnippet({ ...DEFAULT_SPLIT_PANE_STATE, ...vertical?.patch })
    expect(snippet).toContain('direction="vertical"')
    expect(snippet).toContain(':min-left="100"')
    expect(snippet).toContain(':min-right="90"')
    expect(snippet).toContain('#left')
    expect(snippet).toContain('#right')
  })

  it('复制代码与右侧摘要使用同一个比例', () => {
    const state = { ...DEFAULT_SPLIT_PANE_STATE, initial: 0.6 }
    expect(buildSplitPaneSnippet(state)).toContain(':initial="0.6"')
    expect(splitPaneSummary(state)).toContain('60%')
  })
})
