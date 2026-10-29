/**
 * 输入框内标签的行高契约（用户 2026-10-29 报「第二行标签与第一行底部重合」）。
 *
 * 根因：chip 高 22px、vertical-align: bottom，而行框只有 1.6 x 13px 约 20.8px，
 * 盒子整体沉到基线以下，两行就互相压住。
 * 修法：chip 20px 高 + vertical-align: middle，行高抬到 1.75（约 22.8px）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SFC = readFileSync(fileURLToPath(new URL('../NodeBottomBar.vue', import.meta.url)), 'utf8')
const CSS = SFC.replace(/\/\*[\s\S]*?\*\//g, '')

function block(selector: string): string {
  const i = CSS.indexOf(selector + ' {')
  if (i < 0) throw new Error('找不到样式块：' + selector)
  const start = CSS.indexOf('{', i) + 1
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('输入框内 chip 的行高', () => {
  it('chip 高度不超过 20px（22px 会撑破行框）', () => {
    const height = Number(/height\s*:\s*(\d+)px/.exec(block('.nb-editor :deep(.resource-chip)'))?.[1])
    expect(height).toBeLessThanOrEqual(20)
  })

  it('chip 用 vertical-align: middle（bottom 会沉到基线之下压住下一行）', () => {
    expect(block('.nb-editor :deep(.resource-chip)')).toMatch(/vertical-align\s*:\s*middle/)
  })

  it('正文行高不低于 1.7（13px x 1.7 约 22px，刚好容纳 20px 的 chip）', () => {
    for (const sel of ['.nb-editor :deep(.prose-mirror-editor)', '.nb-editor :deep(.ProseMirror)']) {
      const lh = Number(/line-height\s*:\s*([\d.]+)/.exec(block(sel))?.[1])
      expect(lh, sel).toBeGreaterThanOrEqual(1.7)
    }
  })
})

describe('卡片角标：只有视频挂类型角标（用户 2026-10-29）', () => {
  it('视频卡片改用**时长角标**（用户 2026-10-29：右下角改成 分:秒）', () => {
    // 模板里有时长角标，且它的渲染条件限定在视频 + 有时长
    expect(SFC).toContain('class="nb-card-duration"')
    expect(SFC).toContain('formatVideoDuration(tile.duration)')
  })
})
