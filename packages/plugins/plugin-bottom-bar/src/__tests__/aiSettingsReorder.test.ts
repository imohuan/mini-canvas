/**
 * 底栏 AI 按钮排序（用户 2026-11-20）。
 *
 * 用户口径：不要上下箭头的按钮，改用 vue-draggable-plus 拖动排序。
 * 这里钉住三件事：
 * 1. 列表用 VueDraggable 包裹；
 * 2. 没有「上移 / 下移」按钮；
 * 3. 拖拽只从把手开始，不会误触旁边的「编辑 / 删除」。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SFC = readFileSync(
  fileURLToPath(new URL('../BottomBarAiSettings.vue', import.meta.url)),
  'utf8',
)

describe('底栏 AI 按钮排序：拖动而不是箭头', () => {
  it('用 vue-draggable-plus 的 VueDraggable', () => {
    expect(SFC).toContain("from 'vue-draggable-plus'")
    expect(SFC).toContain('<VueDraggable')
  })

  it('不再有上移 / 下移按钮', () => {
    expect(SFC).not.toContain('aria-label="上移"')
    expect(SFC).not.toContain('aria-label="下移"')
    expect(SFC).not.toContain('>↑<')
    expect(SFC).not.toContain('>↓<')
  })

  it('拖拽只从把手开始（行里的编辑 / 删除不会被拖走）', () => {
    expect(SFC).toContain('handle=".bas-grip"')
    expect(SFC).toContain('class="bas-grip"')
  })
})

describe('设置页的 UI 口径（用户 2026-11-20）', () => {
  it('清空模型用关闭图标按钮，不再是一段文字按钮', () => {
    expect(SFC).not.toContain('跟随智能助手默认</Button>')
    expect(SFC).not.toContain('跟随通用模型</Button>')
    expect(SFC).toContain('aria-label="清空通用模型，改跟随智能助手默认"')
    expect(SFC).toContain('aria-label="清空这个按钮的模型，改跟随通用模型"')
  })

  it('描述是整行 textarea（stacked 行），不是单行 input', () => {
    expect(SFC).toMatch(/label="描述"[\s\S]{0,120}stacked/)
    expect(SFC).not.toMatch(/<Input v-model="active\.description"/)
  })

  it('卡片正文统一上下留白（2px 会贴边框）', () => {
    expect(SFC).toContain('.bas :deep(.shadcn-settings-section__body) { padding: 8px 16px; }')
  })

  it('列表里选了具体模型时画模型图标', () => {
    expect(SFC).toContain('class="bas-model-badge"')
    expect(SFC).toContain('resolveModelRowIcon')
  })
})
