/**
 * referenceMarkup（服务端一份）—— 解析用户消息里的**引用标记**。
 *
 * 与前端 `prosemirror-editor-bundle/src/referenceMarkup.ts` 同一套格式（有意各存一份，
 * 与 canvasDoc / GraphModel 同理由：cloud-server 要能独立 `npx` 跑，不依赖工作区私有包）。
 * 两份由测试逐字比对守住（见 __tests__/referenceMarkup.test.ts）。
 *
 *   @[skill:archify](/abs/skills/archify/SKILL.md)   技能（带说明书路径）
 *   @[mcp:smart]                                      MCP 服务（无地址）
 *   @[node:角色立绘](default#n_12)                     节点（画布 id # 节点 id）
 */

export interface ReferenceMarkup {
  kind: string
  name: string
  value: string
}

export const REFERENCE_MARKUP_SOURCE = '@\\[([a-zA-Z][a-zA-Z0-9_-]*):([^\\]]+)\\](?:\\(([^)]*)\\))?'

export function parseReferenceMarkups(text: string): ReferenceMarkup[] {
  const out: ReferenceMarkup[] = []
  if (!text) return out
  const re = new RegExp(REFERENCE_MARKUP_SOURCE, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ kind: m[1].toLowerCase(), name: m[2], value: m[3] ?? '' })
  }
  return out
}

/** 取某一种引用的名字（去重保序）。用于 skills / mcpServers */
export function namesOfKind(text: string, kind: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of parseReferenceMarkups(text)) {
    if (r.kind !== kind || !r.name || seen.has(r.name)) continue
    seen.add(r.name)
    out.push(r.name)
  }
  return out
}

/** 引用标记 → 人类可读文本（`@名字`）。落进转录前用，避免把机器串塞进历史 */
export function stripMarkupToPlain(text: string): string {
  return text.replace(new RegExp(REFERENCE_MARKUP_SOURCE, 'g'), (_full, _kind: string, name: string) => '@' + name)
}

/** 节点引用载荷 `<canvasId>#<nodeId>` 解码 */
export function decodeNodeRef(value: string): { canvasId: string; nodeId: string } {
  const i = (value || '').indexOf('#')
  if (i < 0) return { canvasId: '', nodeId: value || '' }
  return { canvasId: value.slice(0, i), nodeId: value.slice(i + 1) }
}

/**
 * 把用户消息里的引用标记，改写成给模型看的**引导块**（只给钥匙，不给内容）。
 *
 * 关键口径（用户 2026-10-05）：
 * - 技能：**不贴正文**。只说明它在哪，让模型需要时自己 `read_file` —— 系统本就能读本地文件，
 *   于是同一技能引用多次也不会重复占用上下文。
 * - 节点：**不贴内容**。只给画布 id + 节点 id，引导模型用内置画布 MCP 自己去查。
 * - MCP：不在文本里留话（它靠 prefs.mcpServers 决定连哪几个）。
 *
 * 返回改写后的正文（标记本身被替换成引导块；没有标记时原样返回）。
 */
export function buildReferenceGuidance(text: string): string {
  const marks = parseReferenceMarkups(text)
  if (!marks.length) return text

  const skills: Array<{ name: string; path: string }> = []
  const nodes: Array<{ name: string; canvasId: string; nodeId: string }> = []
  for (const m of marks) {
    if (m.kind === 'skill') skills.push({ name: m.name, path: m.value })
    else if (m.kind === 'node') {
      const { canvasId, nodeId } = decodeNodeRef(m.value)
      nodes.push({ name: m.name, canvasId, nodeId })
    }
  }

  const lines: string[] = []
  for (const s of skills) {
    lines.push(
      '- 技能 `' + s.name + '` 已生效' + (s.path ? '，说明书在 `' + s.path + '`' : '') +
        '。需要时用 read_file 读它，再按它做；不要凭空猜测它的内容。',
    )
  }
  for (const n of nodes) {
    lines.push(
      '- 用户引用了画布 `' + (n.canvasId || 'default') + '` 上的节点 `' + n.nodeId + '`（' + n.name +
        '）。它的内容用画布 MCP 工具查询后再回答，不要凭标题猜。',
    )
  }

  const body = stripMarkupToPlain(text)
  if (!lines.length) return body
  return '[references]\n' + lines.join('\n') + '\n[/references]\n\n' + body
}
