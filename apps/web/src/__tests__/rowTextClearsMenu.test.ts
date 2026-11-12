/**
 * 树行「文字不压右侧按钮」契约（用户口径 2026-11-05）。
 *
 * 截图里资产行长名字把行尾「⋯」盖住、画布树行悬停时按钮贴到滚动条边上。
 * 两处都是行内留白不够 / 名字盒子没有裁切导致的可视重叠，
 * 这里钉住「名字区域裁边 + 行尾留够内边距」。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const assetRow = readFileSync(
  new URL('../components/assets/tree/AssetTreeRow.vue', import.meta.url),
  'utf-8',
)
const canvasTree = readFileSync(
  new URL('../components/areas/left-drawer/CanvasTreePanel.vue', import.meta.url),
  'utf-8',
)

describe('树行文字与行尾按钮', () => {
  it('资产行的名字按钮裁边（长名字不会画到「⋯」底下）', () => {
    expect(assetRow).toMatch(/class="[^"]*overflow-hidden[^"]*"\s*:aria-label="'预览 ' \+ row\.name"/)
  })

  it('画布树的行尾留 8px（按钮与滚动条/行边不贴在一起）', () => {
    expect(canvasTree).toMatch(/group\/row[\s\S]{0,200}pr-2/)
    expect(canvasTree).toMatch(/group\/grow[\s\S]{0,200}pr-2/)
  })
})
