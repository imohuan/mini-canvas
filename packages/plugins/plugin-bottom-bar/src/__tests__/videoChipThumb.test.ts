/**
 * 视频标签的缩略图与 hover 预览（用户 2026-11-06）。
 *
 * 实测到的两个问题：
 *   1. 视频标签左侧只剩下类型图标 —— 帧图放在 `url` 里，但渲染只认 `thumbnail_url`；
 *   2. hover 预览黑屏 —— hoverPreview 给的是帧图（png），编辑器却按 video 塞进 <video>。
 * 这两条都是「地址类型判断」写死了，这里钉住修法。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CHIP = readFileSync(fileURLToPath(new URL('../../../../prosemirror-editor-bundle/src/editor/chipRegistry.ts', import.meta.url)), 'utf8')
const EDITOR = readFileSync(fileURLToPath(new URL('../../../../prosemirror-editor-bundle/src/useEditor.ts', import.meta.url)), 'utf8')
const CARDS = readFileSync(fileURLToPath(new URL('../node-bottom-bar/useBottomBarCards.ts', import.meta.url)), 'utf8')
const SOURCE = readFileSync(fileURLToPath(new URL('../panelSource.ts', import.meta.url)), 'utf8')

function fnBody(src: string, signature: string): string {
  const i = src.indexOf(signature)
  expect(i, signature).toBeGreaterThan(-1)
  const end = src.indexOf('\n}\n', i)
  return src.slice(i, end > i ? end : i + 4000)
}

describe('视频标签：左侧缩略图', () => {
  it('帧图在 url 里也要能画（不再只认 thumbnail_url）', () => {
    const body = fnBody(CHIP, 'export function renderRefChip(')
    expect(body).toContain('item.thumbnail_url ||')
    expect(body).toMatch(/urlAsImage/)
  })

  it('mp4 / webm 地址不会被当成图片塞进 <img>', () => {
    const body = fnBody(CHIP, 'export function renderRefChip(')
    expect(body).toMatch(/mp4\|webm\|mov/)
  })

  it('底栏另一条渲染路径（DOMOutputSpec）同样允许视频帧图', () => {
    const body = fnBody(SOURCE, 'function resourceEditorSpec(')
    expect(body).toMatch(/urlLooksVideo/)
    expect(body).not.toMatch(/kind4 === 'image' \|\| self\.url\.startsWith\('data:image\/'\)/)
  })
})

describe('视频 hover 预览：放真视频，不要拿帧图当 video', () => {
  it('底栏给 hoverPreview 的是视频地址', () => {
    expect(CARDS).toMatch(/hoverPreview:\s*\(\)\s*=>\s*tile\.url as string/)
  })

  it('编辑器按拿到的地址判断用 <video> 还是 <img>', () => {
    const body = fnBody(EDITOR, 'const show = (src: string) => {')
    expect(body).toMatch(/previewType\.value = isVideoUrl\(src\)/)
    // 旧写法（标签类型是视频就一律当 video）不能再是赋值语句
    expect(body).not.toMatch(/previewType\.value = kind === 'video' \|\| isVideoUrl/)
  })

  it('没有 data-url 但有 hoverPreview 时仍弹预览（帧图没取到的视频也能播）', () => {
    const body = fnBody(EDITOR, 'function handleResourceMouseEnter(')
    expect(body).toMatch(/if \(!url && !item\?\.hoverPreview\) return/)
  })
})
