/**
 * promptSegments —— 底栏正文 → 结构化提示词分段（零 DOM、零 Vue，Node 可单测）。
 *
 * 用户口径（2026-11-09）：标签的值必须是**资源 id**，和 resources[].id 一一对应；
 * 文本单独成段。顺序就是用户在输入框里看到的顺序。
 */
import { nodeIdOfChip } from './refSlots'

/** 一段提示词：要么是对某个资源的引用，要么是普通文字 */
export interface PromptSegment {
  type: 'tag' | 'prompt'
  /** tag = 资源 id；prompt = 原文 */
  value: string
}

/** ProseMirror doc JSON 的最小形状（不 import 编辑器包，保持可单测） */
interface DocNode {
  type?: string
  attrs?: { id?: unknown; name?: unknown }
  content?: unknown
  text?: unknown
  isText?: boolean
}

/** 一行里的节点 → 文字（标签不在这里处理，调用方单独拆） */
function inlineText(node: DocNode): string {
  if (node.type === 'hard_break') return '\n'
  if (node.type === 'resource') return ''
  if (node.isText || node.type === 'text') {
    return typeof node.text === 'string' ? node.text.replace(/\u200B/g, '') : ''
  }
  return ''
}

/** 一段（paragraph 等）里的文字；遇到 resource 由调用方切段 */
function plainOf(nodes: unknown[]): string {
  let out = ''
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue
    const node = raw as DocNode
    if (node.type === 'resource') continue
    if (Array.isArray(node.content)) out += plainOf(node.content)
    else out += inlineText(node)
  }
  return out
}

/**
 * 富文本 doc → 提示词分段。
 *
 * - `ref-node:<id>` 标签 → `{ type:'tag', value:'<id>' }`；
 * - 还没绑定资源的 `ref-name:<名>` → 普通文字 `@名`（没有 id 可对照，不能冒充资源）；
 * - 段落之间补换行；普通文字原样保留。
 *
 * 没有 doc（AI 改写后只留纯文本）→ 整段当一条 prompt。
 */
export function promptSegmentsFromDoc(doc: unknown, fallbackText = ''): PromptSegment[] {
  const root = doc as DocNode | null | undefined
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) {
    return fallbackText !== '' ? [{ type: 'prompt', value: fallbackText }] : []
  }

  const out: PromptSegment[] = []
  let text = ''
  const flushText = (): void => {
    if (text === '') return
    out.push({ type: 'prompt', value: text })
    text = ''
  }

  const walkInline = (nodes: unknown[]): void => {
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue
      const node = raw as DocNode
      if (node.type === 'resource') {
        const chipId = typeof node.attrs?.id === 'string' ? node.attrs.id : ''
        const nodeId = nodeIdOfChip(chipId)
        if (nodeId) {
          flushText()
          out.push({ type: 'tag', value: nodeId })
        } else {
          const name = typeof node.attrs?.name === 'string' ? node.attrs.name : ''
          text += '@' + name.replace(/\s+/g, '')
        }
        continue
      }
      if (Array.isArray(node.content)) {
        walkInline(node.content)
        continue
      }
      text += inlineText(node)
    }
  }

  const blocks = root.content as unknown[]
  /** 上一段有没有产出（空段落不该撑出多余换行） */
  let prevHad = false
  for (const raw of blocks) {
    if (!raw || typeof raw !== 'object') continue
    const block = raw as DocNode
    const hadBefore = out.length > 0 || text !== ''
    if (prevHad && hadBefore) text += '\n'
    const beforeOut = out.length
    if (Array.isArray(block.content)) walkInline(block.content)
    else text += plainOf([block])
    prevHad = out.length > beforeOut || text !== ''
  }
  flushText()
  return out
}

/** 只给纯文本调用方用：资源引用显示成 @名称 */
export function promptSegmentsText(
  segments: ReadonlyArray<PromptSegment>,
  resources: ReadonlyArray<{ id: string; name?: string }>,
): string {
  const nameOf = new Map(resources.map((r) => [r.id, String(r.name ?? '')]))
  return segments
    .map((s) => (s.type === 'tag' ? '@' + (nameOf.get(s.value) || s.value) : s.value))
    .join('')
}
