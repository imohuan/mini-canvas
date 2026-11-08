/**
 * 点标签后「光标先跳到标签前、再跳回标签后」的闪两下（用户 2026-10-27 报、2026-11-08 复发）。
 *
 * 这条不是样式问题，而是**两条事务抢同一颗标签的选区**：
 *   ① 点下去后 ProseMirror 把整颗标签选中（NodeSelection），并启动 1s 定时器；
 *   ② 浏览器在这 1s 里先给一个「紧贴标签前面」的原生文本光标，PM 读到就派发一条
 *      只改选区的事务 → 选中立刻没了、光标跑到标签前；
 *   ③ 定时器再把光标挪到标签后 → 用户看到「跳前、跳后」两下。
 *
 * 修法是吞掉 ② 那种纯选区噪声（isChipCaretNoise）。这里把判定条件钉死，
 * 防止以后有人觉得「这函数没人用」顺手删掉，或者放宽条件把真实点击也吞了。
 *
 * ⚠️ 同一条约束的另一半在 refreshChips / replaceResource：
 *    等待落光标期间**不许**因为「只改了显示」而 setNodeMarkup 重建标签节点。
 *    序号（chipIndex）就是踩过这个坑的功能，见 refChipIndex.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { NodeSelection, TextSelection } from 'prosemirror-state'
import { mySchema } from '../editor/schema.ts'
import { isChipCaretNoise } from '../useEditor.ts'

/** 造一段「标签 + 标签」的正文，返回文档与第一颗标签的位置 */
function docWithChip() {
  const resource = mySchema.nodes.resource!
  const paragraph = mySchema.nodes.paragraph!
  const chip = resource.create({ id: 'ref-node:n1', name: '图片 1', category: '素材', chipKind: 'image' })
  const doc = mySchema.node('doc', null, [paragraph.create(null, [chip, mySchema.text('甲')])])
  return { doc, chipPos: 1, chipSize: chip.nodeSize }
}

describe('isChipCaretNoise：只吞「贴标签前面的噪声光标」', () => {
  it('等待落光标 + 当前整颗选中 + 新光标紧贴标签前 → 吞掉', () => {
    const { doc, chipPos } = docWithChip()
    const pending = { from: chipPos }
    const tr = {
      docChanged: false,
      selectionSet: true,
      selection: TextSelection.create(doc, chipPos),
    }
    expect(isChipCaretNoise(tr, pending, NodeSelection.create(doc, chipPos))).toBe(true)
  })

  it('没在等落光标 → 放行（普通点选/方向键都走这条）', () => {
    const { doc, chipPos } = docWithChip()
    const tr = { docChanged: false, selectionSet: true, selection: TextSelection.create(doc, chipPos) }
    expect(isChipCaretNoise(tr, null, NodeSelection.create(doc, chipPos))).toBe(false)
  })

  it('事务改了文档 → 放行（插入/删除/换绑必须真的生效）', () => {
    const { doc, chipPos } = docWithChip()
    const tr = { docChanged: true, selectionSet: true, selection: TextSelection.create(doc, chipPos) }
    expect(isChipCaretNoise(tr, { from: chipPos }, NodeSelection.create(doc, chipPos))).toBe(false)
  })

  it('当前已经不是这颗标签的整颗选中 → 放行（用户中途点了别处）', () => {
    const { doc, chipPos, chipSize } = docWithChip()
    const tr = { docChanged: false, selectionSet: true, selection: TextSelection.create(doc, chipPos) }
    const elsewhere = TextSelection.create(doc, chipPos + chipSize + 1)
    expect(isChipCaretNoise(tr, { from: chipPos }, elsewhere)).toBe(false)
  })

  it('新选区不在标签前面（例如落到标签后面）→ 放行', () => {
    const { doc, chipPos, chipSize } = docWithChip()
    const tr = { docChanged: false, selectionSet: true, selection: TextSelection.create(doc, chipPos + chipSize) }
    expect(isChipCaretNoise(tr, { from: chipPos }, NodeSelection.create(doc, chipPos))).toBe(false)
  })

  it('没设选区的事务（例如 metadata 更新）→ 放行', () => {
    const { doc, chipPos } = docWithChip()
    const tr = { docChanged: false, selectionSet: false, selection: TextSelection.create(doc, chipPos) }
    expect(isChipCaretNoise(tr, { from: chipPos }, NodeSelection.create(doc, chipPos))).toBe(false)
  })
})
