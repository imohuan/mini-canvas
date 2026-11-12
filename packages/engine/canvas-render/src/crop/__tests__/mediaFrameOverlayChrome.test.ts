/**
 * 媒体编辑浮层的外观契约：
 * - 裁剪 / 扩展都提供 8 个控制点（4 角 + 4 边中点）；用户明确要求图片裁剪与视频一致；
 * - 控制点、框线、三分线压在图上看，必须恒定白色，不能跟着暗色主题变深。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import MediaFrameOverlay from '../MediaFrameOverlay.vue'

function render(mode: 'crop' | 'expand'): Promise<string> {
  const app = createSSRApp({
    render: () => h(MediaFrameOverlay, { mode, mediaWidth: 1600, mediaHeight: 900 }),
  })
  return renderToString(app)
}

describe('媒体编辑浮层控制点', () => {
  it('裁剪有 8 个控制点（4 角 + 4 条边中点）', async () => {
    const html = await render('crop')
    expect((html.match(/class="mfo-handle"/g) ?? []).length).toBe(8)
  })

  it('扩展同样有 8 个控制点', async () => {
    const html = await render('expand')
    expect((html.match(/class="mfo-handle"/g) ?? []).length).toBe(8)
  })

  it('控制点底色固定白色，不随暗色主题变成深灰', () => {
    const src = readFileSync(new URL('../MediaFrameOverlay.vue', import.meta.url), 'utf-8')
    const handleRule = src.match(/\.mfo-handle\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(handleRule).toMatch(/background:\s*#fff\b/)
    expect(handleRule).not.toContain('var(--ui-panel')
  })

  it('框线与三分线固定白色，暗背景上也看得见', () => {
    const src = readFileSync(new URL('../MediaFrameOverlay.vue', import.meta.url), 'utf-8')
    const frameRule = src.match(/\.mfo-frame\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    const gridRule = src.match(/\.mfo-grid-line\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(frameRule).toMatch(/border:\s*1px solid #fff\b/)
    expect(frameRule).not.toMatch(/box-shadow:\s*0 0 0 1px rgba\(0,\s*0,\s*0,\s*0\.5\)/)
    expect(gridRule).toMatch(/background:\s*#fff\b/)
    expect(gridRule).not.toContain('background: rgba(0, 0, 0')
  })
})
