/**
 * 弹窗外层内边距契约（用户口径 2026-11-02）：
 * 「全局设置顶部和顶部 padding 相差太多」「生成历史界面 UI 还是没改过来」。
 *
 * 根因不是面板自己写错，而是 shadcn DialogContent 自带 p-6 + gap-6，
 * 面板内部又各带一层 px/pt/pb —— 两层叠起来，顶部变成 40px、
 * 生成历史标题左边 48px、卡片区 64px，左右也不对称。
 *
 * 为什么锁在 host.css：DialogContent 被 Teleport 到 body，根节点没有
 * data-v 作用域属性，写在 AppDialog.vue 的 scoped 样式里匹配不上（实测查过）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const css = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles/host.css'),
  'utf-8',
)

describe('弹窗外层内边距归零', () => {
  const rule = css.match(/\[data-slot='dialog-content'\]\s*\{([^}]*)\}/)?.[1] ?? ''

  it('DialogContent 的 padding / gap 归零，内边距只由面板自己那一层决定', () => {
    expect(rule, '缺 [data-slot=dialog-content] 规则').not.toBe('')
    expect(rule, '外层 padding 没归零，会和面板内部的 px/pt 叠加').toMatch(/padding:\s*0\s*!important/)
    expect(rule, '外层 gap 没归零，标题栏与内容之间会多一段').toMatch(/gap:\s*0\s*!important/)
  })
})
