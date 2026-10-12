/**
 * 退格删标签 —— 光标紧跟在标签（atom 节点）后面时，退格必须真的能把标签删掉。
 *
 * 为什么单测（用户 2026-10-11 报，附截图）：
 * 「光标在这个标签后面，点删除根本没有任何反应；只有先左键选中这个节点才能删」。
 * 根因是光标修复插件在标签前后垫的零宽空格（\u200B）——它看不见，却会先吃掉一次退格，
 * 而插件在文档变化后立刻又把垫片补回来，于是用户眼里就是「按了没反应」。
 * 这里钉住两条命令：deleteAtomBackward / deleteAtomForward。
 */
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { parsePlainTextToContent, deleteAtomBackward, deleteAtomForward } from '../useEditor.ts'

const ZW = '\u200B'

/** 借 parsePlainTextToContent 拿到的节点反查它所属的 schema —— 编辑器用的就是这一份 */
const schema = parsePlainTextToContent('<ref type="node" name="标签" canvasId="c" nodeId="1" />', undefined)[0].type.schema
const text = (s: string) => schema.text(s)
const tag = () => schema.nodes.resource.create({
  id: 'r1', name: '标签', category: '节点', url: '', value: '', refKind: 'node', refValue: 'c#1',
})
/** 造一个只含一个段落的文档，并把光标放到 caret 这个位置 */
const stateWith = (kids: any[], caret: number) => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, kids)])
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) })
}
const run = (cmd: any, state: EditorState) => {
  let after: any = null
  const handled = cmd(state, (tr: any) => { after = state.apply(tr) })
  return { handled, after }
}
const kinds = (state: EditorState) => {
  const para = state.doc.child(0)
  const out: string[] = []
  for (let i = 0; i < para.childCount; i++) out.push(para.child(i).type.name)
  return out
}

describe('退格删标签：光标在标签后面', () => {
  it('标签在行尾（后面只有垫的零宽空格）→ 一次退格删掉标签本身', () => {
    const state = stateWith([text(ZW), tag(), text(ZW)], 4)
    const { handled, after } = run(deleteAtomBackward, state)
    expect(handled).toBe(true)
    expect(kinds(after)).not.toContain('resource')
  })

  it('标签后面是垫的零宽空格 + 更多文字 → 删标签，文字留着', () => {
    const state = stateWith([text(ZW), tag(), text(ZW), text('abc')], 4)
    const { handled, after } = run(deleteAtomBackward, state)
    expect(handled).toBe(true)
    expect(kinds(after)).not.toContain('resource')
    expect(after.doc.textContent).toBe('abc')
  })

  it('删完不留看不见的零宽空格（下次退格不会再被吃掉）', () => {
    const state = stateWith([text(ZW), tag(), text(ZW)], 4)
    const { after } = run(deleteAtomBackward, state)
    expect(after.doc.textContent).toBe('')
  })

  it('标签在行尾、光标紧贴标签（垫片在光标前）→ 同样删标签', () => {
    const state = stateWith([text(ZW), tag(), text(ZW)], 3)
    const { handled, after } = run(deleteAtomBackward, state)
    expect(handled).toBe(true)
    expect(kinds(after)).not.toContain('resource')
  })

  it('标签前面是普通文字、光标在标签后面 → 删标签，前面的文字留着', () => {
    const state = stateWith([text('ab'), tag(), text(ZW)], 5)
    const { handled, after } = run(deleteAtomBackward, state)
    expect(handled).toBe(true)
    expect(kinds(after)).not.toContain('resource')
    expect(after.doc.textContent).toBe('ab')
  })

  it('光标在标签**前面** → 不接管（删的是光标前的文字，不是标签）', () => {
    const state = stateWith([text('ab'), tag(), text(ZW)], 3)
    const { handled } = run(deleteAtomBackward, state)
    expect(handled).toBe(false)
  })

  it('光标前是普通字符 → 不接管（交给原生命令删字符）', () => {
    const state = stateWith([text(ZW), tag(), text('a')], 4)
    const { handled } = run(deleteAtomBackward, state)
    expect(handled).toBe(false)
  })

  it('纯文字段落 → 不接管', () => {
    const state = stateWith([text('ab')], 3)
    const { handled } = run(deleteAtomBackward, state)
    expect(handled).toBe(false)
  })

  it('有选区（非空）→ 不接管', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [text('ab')])])
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1, 2) })
    const { handled } = run(deleteAtomBackward, state)
    expect(handled).toBe(false)
  })
})

describe('向前删（Delete）：光标在标签前面', () => {
  it('标签在行首（前面只有垫的零宽空格）→ 一次删除删掉标签本身', () => {
    const state = stateWith([text(ZW), tag(), text(ZW)], 1)
    const { handled, after } = run(deleteAtomForward, state)
    expect(handled).toBe(true)
    expect(kinds(after)).not.toContain('resource')
  })

  it('光标后面是普通字符 → 不接管', () => {
    const state = stateWith([text('ab')], 1)
    const { handled } = run(deleteAtomForward, state)
    expect(handled).toBe(false)
  })
})
