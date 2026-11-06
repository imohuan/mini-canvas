/**
 * 项目页整页的样式契约（静态检查）。
 *
 * 用户 2026-11-06 实测：素材墙在项目页只占左边一截、右侧一大片空白，
 * 原因是 flex 链里 `.sg` 没有吃满宽度；背景也自带一块白底，和浅灰页面不融合。
 * 这里锁住这两条，防止以后改样式又退回去。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf-8')

describe('素材库铺满与背景融合', () => {
  it('画廊根节点吃满父级宽度（不是只写 height:100%）', () => {
    const css = read('components/StyleGalleryView.vue')
    const block = css.slice(css.indexOf('.sg {'), css.indexOf('.sg--bare'))
    expect(block).toContain('flex: 1')
    expect(block).toContain('width: 100%')
    expect(block).toContain('min-width: 0')
  })

  it('项目模式把画廊背景切成透明，弹窗模式仍是白底', () => {
    const gallery = read('components/StyleGalleryView.vue')
    expect(gallery).toContain("'sg--bare': surface === 'transparent'")
    expect(gallery).toContain('.sg--bare { background: transparent; }')
    const content = read('components/StyleLibraryContent.vue')
    expect(content).toContain("props.mode === 'project' ? 'transparent' : 'panel'")
  })

  it('弹窗外壳只负责壳，内容由独立组件渲染（项目页不套弹窗）', () => {
    const overlay = read('components/StyleLibraryOverlay.vue')
    expect(overlay).toContain('<StyleLibraryContent')
    expect(overlay).not.toContain('inline')
    const tab = read('components/ProjectsStyleTab.vue')
    expect(tab).toContain('<StyleLibraryContent mode="project" />')
    expect(tab).not.toContain('Overlay')
  })
})
