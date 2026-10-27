/**
 * 可视化节点的底色契约（用户口径 2026-10-27：「顺便优化一下你的这个可视化节点的背景」）。
 *
 * 现象：同一张画布上，视频节点是白的，可视化节点明显灰一档。
 * 根因：UiContent 自己给 .ui-node 铺了 --canvas-node-surface（卡片表面灰），
 * 而其它媒体节点都不铺底色，让壳的内容底（--card-content-surface，亮白 / 暗深）透出来。
 *
 * 这里直接读样式段（SSR 不输出 scoped CSS），锁住「不自己铺底色」这条。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../UiContent.vue', import.meta.url), 'utf8')
const style = src.slice(src.indexOf('<style'))

describe('可视化节点底色', () => {
  it('.ui-node 不自己铺底色：与视频/图片节点同源，让壳的内容底透出来', () => {
    const rule = style.match(/\.ui-node\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toMatch(/background\s*:/)
  })

  it('iframe 保持透明（生成物自己的底色由生成页面决定，宿主不盖一层）', () => {
    const rule = style.match(/\.ui-frame\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/background:\s*transparent/)
  })
})
