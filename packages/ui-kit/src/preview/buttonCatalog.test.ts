import { describe, expect, it } from 'vitest'
import { BUTTON_PRESETS, DEFAULT_BUTTON_STATE, buildButtonSnippet, buildStateSummary } from './buttonCatalog'

describe('Button 展示页配置', () => {
  it('示例代码包含当前文字、外观和尺寸；纯图标时补无障碍名称', () => {
    const snippet = buildButtonSnippet({
      ...DEFAULT_BUTTON_STATE,
      label: '发布作品',
      variant: 'danger',
      size: 'lg',
      showIcon: false,
      iconOnly: true,
    })
    expect(snippet).toContain('variant="danger"')
    expect(snippet).toContain('size="lg"')
    expect(snippet).toContain('aria-label="发布作品"')
    expect(snippet).toContain('<template #icon>')
    expect(snippet).not.toContain('    发布作品\n')
  })

  it('图标插槽会出现在代码里，普通文字仍然保留', () => {
    const snippet = buildButtonSnippet({ ...DEFAULT_BUTTON_STATE, label: '保存' })
    expect(snippet).toContain('<template #icon>')
    expect(snippet).toContain('    保存')
  })

  it('纯图标时也显示示例图标，复制后不会得到一个空方按钮', () => {
    const snippet = buildButtonSnippet({ ...DEFAULT_BUTTON_STATE, label: '更多', iconOnly: true, showIcon: false })
    expect(snippet).toContain('<template #icon>')
    expect(snippet).toContain('aria-label="更多"')
    expect(snippet).not.toContain('    更多\n')
  })

  it('空白文字回退为“按钮”，不会生成空标签', () => {
    const snippet = buildButtonSnippet({ ...DEFAULT_BUTTON_STATE, label: '   ', showIcon: false })
    expect(snippet).toContain('    按钮')
  })

  it('预设覆盖外观和文案，界面摘要只写用户看得懂的词', () => {
    const danger = BUTTON_PRESETS.find((preset) => preset.id === 'danger')
    expect(danger?.patch.variant).toBe('danger')
    expect(buildStateSummary({ ...DEFAULT_BUTTON_STATE, ...danger?.patch })).toBe('危险 · 中')
  })
})
