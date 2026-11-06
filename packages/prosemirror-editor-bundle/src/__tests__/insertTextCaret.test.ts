/**
 * insertText 的光标契约（用户 2026-11-06 实测的 bug）。
 *
 * 「首先取消所有节点选中，然后点节点选中 → 直接点底栏 @」：
 * 以前 @ 确实加到了文末，但光标被映射回 contenteditable 开头，
 * 编辑器看不到刚插入的 @，@ 菜单不会弹。
 * 修法是插入后显式 setSelection 到 from + text.length。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(fileURLToPath(new URL('../useEditor.ts', import.meta.url)), 'utf8')

describe('insertText：插入后光标跟着字符走', () => {
  it('插入事务里显式设置选区（只 insertText 会被映射回开头）', () => {
    const i = SRC.indexOf('function insertText(text: string)')
    expect(i).toBeGreaterThan(-1)
    const body = SRC.slice(i, SRC.indexOf('\n  }\n', i))
    expect(body).toContain('setSelection(TextSelection.create(tr.doc, Math.min(start + text.length')
  })

  it('没有光标时用文末位置（Selection.atEnd），不是开头', () => {
    const i = SRC.indexOf('function insertText(text: string)')
    const body = SRC.slice(i, SRC.indexOf('\n  }\n', i))
    expect(body).toContain('Selection.atEnd(state.doc)')
  })

  it('编辑器失焦时用最后一次真实选区，而不是 DOM 里被重置的落点', () => {
    const i = SRC.indexOf('function insertText(text: string)')
    const body = SRC.slice(i, SRC.indexOf('\n  }\n', i))
    expect(body).toContain('lastFocusedSelection')
  })
})
