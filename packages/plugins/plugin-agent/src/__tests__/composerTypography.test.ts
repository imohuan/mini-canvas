/**
 * 输入框正文字号（用户 2026-11-06：输入框的字比对话列表大）。
 *
 * 根因：bundle 的 `.prose-mirror-editor .ProseMirror` 直配 16px/24px。
 * 外壳上设字号只是继承值，输给直配 —— 于是输入的字是 16px，
 * 而对话列表正文（.md-p）和占位符都是 14px，看着比周围都大。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GLOBAL_CSS = readFileSync(
  path.resolve(HERE, '../ui/conversation/AgentComposer.global.css'),
  'utf8',
)
const PART1 = readFileSync(
  path.resolve(HERE, '../ui/conversation/agent-composer/part1.css'),
  'utf8',
)

describe('输入框字号与对话正文一致', () => {
  it('正文 .ProseMirror 覆写成 14px（写在编辑器本体上，不是外壳）', () => {
    const at = GLOBAL_CSS.indexOf('.ac-editor .prose-mirror-editor .ProseMirror {')
    expect(at).toBeGreaterThan(-1)
    const block = GLOBAL_CSS.slice(at, GLOBAL_CSS.indexOf('}', at))
    expect(block).toMatch(/font-size:\s*14px/)
    // 行高留 24px：22px 高的标签 chip 不能把行撑开成两行
    expect(block).toMatch(/line-height:\s*24px/)
  })

  it('占位符与正文同字号同字高（否则空态与输入态切换会跳一下）', () => {
    const at = PART1.indexOf('.ac-placeholder {')
    expect(at).toBeGreaterThan(-1)
    const block = PART1.slice(at, PART1.indexOf('}', at))
    expect(block).toMatch(/font-size:\s*14px/)
    expect(block).toMatch(/line-height:\s*24px/)
  })
})
