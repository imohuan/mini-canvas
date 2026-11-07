/**
 * 标签编辑态（用户 2026-11-06）：候选菜单开着时左侧固定显示铅笔图标，
 * 不能再被缩略图盖回去；同时缩略图与名字一样高。
 *
 * 源码契约测试：DOM 由 bundle 渲染，这里钉住「谁加类、谁画铅笔、尺寸多少」。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readBottomBarCss } from './readBottomBarCss'

const CSS = readBottomBarCss()
const MENU_TS = readFileSync(fileURLToPath(new URL('../node-bottom-bar/useBottomBarTagMenu.ts', import.meta.url)), 'utf8')
const CHIP_DOM = readFileSync(
  fileURLToPath(new URL('../../../../prosemirror-editor-bundle/src/editor/chipDom.ts', import.meta.url)),
  'utf8',
)

function block(selector: string): string {
  const i = CSS.indexOf(selector + ' {')
  if (i < 0) throw new Error('找不到样式块：' + selector)
  return CSS.slice(CSS.indexOf('{', i) + 1, CSS.indexOf('}', i))
}

describe('标签编辑态：左侧显示铅笔', () => {
  it('菜单一开就标记这颗标签、菜单一关就恢复', () => {
    expect(MENU_TS).toContain('setChipEditing')
    expect(MENU_TS).toContain('watch(tagMenuOpen')
  })

  it('编辑态把缩略图和类型图标都藏掉（不能被图盖回去）', () => {
    const css = block('.nb-editor .resource-chip--editing .resource-chip-thumb,\n.nb-editor .resource-chip--editing .resource-chip-icon')
    expect(css).toMatch(/opacity\s*:\s*0/)
  })

  it('编辑态用铅笔 mask 画图标，尺寸跟图标格一致（14px）', () => {
    const css = block('.nb-editor .resource-chip--editing::after')
    expect(css).toMatch(/mask-image\s*:\s*url\("data:image\/svg\+xml/)
    expect(css).toMatch(/width\s*:\s*14px/)
    expect(css).toMatch(/height\s*:\s*14px/)
  })

  it('标签被重建后仍会补回编辑态（渲染后按 id 再套一次类）', () => {
    expect(CHIP_DOM).toContain('export function applyChipEditingState')
    expect(CHIP_DOM).toContain('resource-chip--editing')
  })
})

describe('标签缩略图与文字同高', () => {
  it('缩略图钉成 14×14（公共样式的 18px 会把它放大）', () => {
    const css = block('.nb-editor .resource-chip > img.resource-chip-thumb')
    expect(css).toMatch(/width\s*:\s*14px/)
    expect(css).toMatch(/height\s*:\s*14px/)
  })

  it('名字行高与图标同高（12px 字号配 14px 行框）', () => {
    const css = block('.nb-editor .resource-chip-name')
    expect(css).toMatch(/line-height\s*:\s*14px/)
  })
})

describe('标签左侧图标：hover 换铅笔 + 图标高亮（用户 2026-11-07）', () => {
  it('hover 整颗标签就换成铅笔（不只靠菜单打开）', () => {
    // 缩略图与类型图标要在 hover 时藏掉，由同一组规则覆盖 hover 与「菜单打开」两个状态
    const i = CSS.indexOf('.nb-editor .resource-chip--editable:hover .resource-chip-thumb,')
    expect(i).toBeGreaterThan(-1)
    const group = CSS.slice(i, CSS.indexOf('}', CSS.indexOf('{', i)))
    expect(group).toContain('.resource-chip--editable:hover .resource-chip-icon')
    expect(group).toContain('.resource-chip--editing .resource-chip-icon')
    expect(CSS).toMatch(/\.resource-chip--editable:hover::after,\s*\n\.nb-editor \.resource-chip--editing::after \{/)
  })

  it('指针进到图标上时铅笔变深（只改颜色，不加背景）', () => {
    expect(CSS).toMatch(/\.resource-chip--editable:has\(\.resource-chip-icon:hover\)::after\s*\{[^}]*background-color:\s*var\(--ui-ink/)
    // 用户明确不要背景块
    expect(CSS).not.toMatch(/radial-gradient/)
    expect(CSS).not.toMatch(/\.resource-chip--editable:hover\s*\{[^}]*background:/)
  })
})
