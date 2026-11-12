import type { Node as PMNode, ResolvedPos } from "prosemirror-model";
import type { EditorState, Transaction } from "prosemirror-state";

// 检查节点是否是 atom 节点
export function isAtomNode(nodeType: string): boolean {
  return nodeType === "resource";
}

/**
 * 垫片判定：这段文字里**只有**零宽空格才算垫片（空串也算）。
 * 垫片可能与真实文字并在一个文本节点里（`"\u200Babc"`），所以只认「剥掉零宽空格后为空」。
 */
function isSpacerChars(text: string | undefined): boolean {
  return (text ?? "").replace(/\u200B/g, "") === "";
}

/**
 * 退格：光标跟在标签（atom 节点）后面时，把标签删掉。
 *
 * 为什么需要它（用户 2026-10-11 报，附截图）：光标停在标签后面按退格「没有任何反应」，
 * 得先用左键选中标签才能删。根因是 createCursorFixPlugin 在标签两侧垫了零宽空格：
 *   ① 退格先删掉那个**看不见的**垫片 —— 用户看不到任何变化；
 *   ② 垫片一没，插件下一帧立刻又补回来（它按「标签在行尾 / 相邻」判断）；
 *   ③ 于是表现为「按了没反应」，标签始终不动。
 * 这里显式接管「光标与标签之间只有垫片」的情形：连垫片带标签一起删。
 * 中间还有真实文字时不接管 —— 那时用户要删的正是那些字。
 */
export function deleteAtomBackward(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $head, empty } = state.selection
  if (!empty) return false
  const hit = atomBeforeCaret($head)
  if (!hit) return false
  if (dispatch) {
    const start = $head.start()
    // 从「标签左边那截垫片」一路删到光标：标签、它两侧的垫片一起清干净。
    // 只删到标签左边、留着垫片的话，那截看不见的垫片就是下一次「按了没反应」的元凶。
    dispatch(state.tr.delete(start + hit.from, $head.pos).scrollIntoView())
  }
  return true
}

/**
 * 向前删（Delete）：光标在标签（atom 节点）前面时，把标签删掉。
 * 与 deleteAtomBackward 对称，理由相同 —— 否则一次删除只啃掉看不见的垫片。
 */
export function deleteAtomForward(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $head, empty } = state.selection
  if (!empty) return false
  const hit = atomAfterCaret($head)
  if (!hit) return false
  if (dispatch) {
    const start = $head.start()
    dispatch(state.tr.delete($head.pos, start + hit.to).scrollIntoView())
  }
  return true
}

/** 标签（atom 节点）在父块里的内容偏移区间。 */
interface AtomRange {
  from: number
  to: number
}

/**
 * 找光标**前方**那个「与光标之间只隔着垫片」的标签。
 *
 * 为什么不用 `$head.nodeBefore`：光标紧贴标签时它是标签本身，光标落在垫片后面时它是垫片，
 * 光标落在 `"\u200Babc"` 这种混排文本里时它是被切过的文本 —— 三种形态都要认，
 * 只能按父块的孩子逐个往前扫，边扫边要求「除垫片外不许有真实字符」。
 */
function atomBeforeCaret($head: ResolvedPos): AtomRange | null {
  const parent = $head.parent
  if (!parent.isTextblock) return null
  const caret = $head.parentOffset
  const ranges = childRanges(parent)
  // 从光标处往回走：先跨过垫片，碰到的第一个标签就是目标；
  // 碰到真实文字就说明用户要删的是那些字（不是标签），让位给原生命令。
  for (let i = ranges.length - 1; i >= 0; i--) {
    const { child, from, to } = ranges[i]
    if (to > caret) {
      // 光标落在这段中间：只有「左边那一截全是垫片」才算贴在标签后面
      if (child.isText && isSpacerChars((child.text ?? "").slice(0, caret - from))) continue
      return null
    }
    if (child.isText) {
      if (!isSpacerChars(child.text)) return null
      continue
    }
    // 只认标签（resource）；别的行内叶子交给原生命令，不抢它的行为
    if (!isAtomNode(child.type.name)) return null
    // 连同标签左边那截垫片一起删（垫片留着就是下一次「按了没反应」的元凶）
    const prev = i > 0 ? ranges[i - 1] : null
    const from2 = prev && prev.child.isText && isSpacerChars(prev.child.text) ? prev.from : from
    return { from: from2, to }
  }
  return null
}

/** 找光标**后方**那个「与光标之间只隔着垫片」的标签（向前删用，逻辑与上面镜像）。 */
function atomAfterCaret($head: ResolvedPos): AtomRange | null {
  const parent = $head.parent
  if (!parent.isTextblock) return null
  const caret = $head.parentOffset
  const ranges = childRanges(parent)
  for (let i = 0; i < ranges.length; i++) {
    const { child, from, to } = ranges[i]
    if (to <= caret) continue
    if (child.isText) {
      if (!isSpacerChars((child.text ?? "").slice(caret - from))) return null
      continue
    }
    if (!isAtomNode(child.type.name)) return null
    // 连同标签右边那截垫片一起删
    const next = i + 1 < ranges.length ? ranges[i + 1] : null
    const to2 = next && next.child.isText && isSpacerChars(next.child.text) ? next.to : to
    return { from, to: to2 }
  }
  return null
}

/** 父块里每个孩子的内容偏移区间（顺序与 childCount 一致）。 */
function childRanges(parent: PMNode): { child: PMNode; from: number; to: number }[] {
  const out: { child: PMNode; from: number; to: number }[] = []
  let offset = 0
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i)
    out.push({ child, from: offset, to: offset + child.nodeSize })
    offset += child.nodeSize
  }
  return out
}
