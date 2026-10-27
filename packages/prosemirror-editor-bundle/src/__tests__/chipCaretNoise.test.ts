/**
 * 点标签后的光标跳两步 —— 只允许跳一次。
 *
 * 用户口径（2026-10-27）：点标签 → 整颗选中 → 0.5s 后光标落到标签**之后**。
 * 实测会先出现一次「光标在标签前」，再跳到后面。
 * 根因：ProseMirror 的 NodeSelection 不可见，浏览器就近给了个标签前的文本光标，
 * ProseMirror 读到 DOM 选区后又派发一条 selection-only 事务。
 *
 * 这里钉住 isChipCaretNoise 的判定：这种「紧贴标签前」的纯选区事务必须被识别为噪声；
 * 换到别的位置、或者文档真的改了，都要放行。
 */
import { describe, expect, it } from 'vitest'
import { EditorState, NodeSelection, TextSelection, type Selection } from 'prosemirror-state'
import { parsePlainTextToContent, isChipCaretNoise } from '../useEditor.ts'

const schema = parsePlainTextToContent('<ref type="node" name="标签" canvasId="c" nodeId="1" />', undefined)[0].type.schema
const tag = () => schema.nodes.resource.create({
  id: 'r1', name: '标签', category: '节点', url: '', value: '', refKind: 'node', refValue: 'c#1',
})

/**
 * 文档：paragraph[ 标签 ]。
 * 同一个 doc 实例既给 state 又给事务 —— 两边各造一份文档，setSelection 会报
 * "must point at the current document"。
 */
const setup = (makeSelection: (doc: any) => Selection) => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [tag()])])
  const state = EditorState.create({ schema, doc, selection: makeSelection(doc) })
  return { doc, state }
}

describe('isChipCaretNoise：点标签后多余的"光标跳前面"', () => {
  it('当前是整颗选中 + 新事务把光标放到标签前 → 判为噪声', () => {
    // 标签在段落里的位置是 1（段落从 0 开始、内容从 1 开始）
    const TAG_POS = 1
    const { doc, state } = setup((d) => NodeSelection.create(d, TAG_POS))
    // "标签前"的文本光标与标签起点同位置
    const tr = state.tr.setSelection(TextSelection.create(doc, TAG_POS))
    expect(isChipCaretNoise(tr, { from: TAG_POS }, state.selection)).toBe(true)
  })

  it('新事务落到别的位置 → 放行（用户真的点了别处）', () => {
    const TAG_POS = 1
    const { doc, state } = setup((d) => NodeSelection.create(d, TAG_POS))
    // 标签只占 1 个位置，标签之后就是 TAG_POS + 1
    const tr = state.tr.setSelection(TextSelection.create(doc, TAG_POS + 1))
    expect(isChipCaretNoise(tr, { from: TAG_POS }, state.selection)).toBe(false)
  })

  it('文档变了的事务 → 放行（输入、删除都要正常生效）', () => {
    const TAG_POS = 1
    const { state } = setup((d) => NodeSelection.create(d, TAG_POS))
    const tr = state.tr.insertText('x', TAG_POS)
    expect(isChipCaretNoise(tr, { from: TAG_POS }, state.selection)).toBe(false)
  })

  it('没有待落光标（普通点击） → 放行', () => {
    const TAG_POS = 1
    const { doc, state } = setup((d) => NodeSelection.create(d, TAG_POS))
    const tr = state.tr.setSelection(TextSelection.create(doc, TAG_POS))
    expect(isChipCaretNoise(tr, null, state.selection)).toBe(false)
  })
})
