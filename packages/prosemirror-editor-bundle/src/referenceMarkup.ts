/**
 * referenceMarkup —— 输入框里「引用标记」的唯一格式与纯解析（零 DOM、零 Vue，可单测）。
 *
 * 为什么要有这一份：技能 / MCP / 节点三种引用以前各走各的「特殊属性」（skills:[…]、
 * mcpServers:[…]）+ 标签序列化成 `@名字 `。两条路都漏信息：
 *   · 标签退化成 `@名字` 后，后端认不出它是技能还是 MCP，更认不出节点；
 *   · 属性把「引用了谁」从正文里拆出去，删掉标签引用却不失效。
 *
 * 统一成**一段人类可读的标记文本**，它就是唯一真相：
 *
 *   @[skill:archify](/abs/path/skills/archify/SKILL.md)   技能（带说明书地址）
 *   @[mcp:smart]                                           MCP 服务（不需要地址）
 *   @[node:角色立绘](default#n_12)                          节点（画布 id + 节点 id）
 *
 * 发消息时正文原样带上；后端按这个格式解析出「这次用了哪些技能 / 连哪些 MCP / 引用了哪些节点」。
 * 删掉标记，引用当场消失 —— 不再有第二份状态需要同步。
 */

/** 一个引用标记（解析结果） */
export interface ReferenceMarkup {
  /** 引用种类：skill / mcp / node（小写；未知种类原样保留，后端自行忽略） */
  kind: string
  /** 展示名（技能名 / 服务名 / 节点标题） */
  name: string
  /** 载荷：技能=说明书路径；节点=画布id#节点id；MCP=空串 */
  value: string
}

/**
 * 标记正则。
 * - 名称里不允许 `]`，避免把后面的东西一起吃掉；
 * - 载荷是可选的 `(...)`，且里面不允许 `)`（路径 / id 都不会有括号）；
 * - 全局匹配用，最后记得把 lastIndex 复位（见 parseReferenceMarkups）。
 */
export const REFERENCE_MARKUP_RE = /@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\(([^)]*)\))?/g

/** 把一个标记格式化成文本（value 为空时不带括号后缀） */
export function formatReferenceMarkup(kind: string, name: string, value?: string): string {
  const head = '@[' + kind + ':' + name + ']'
  return value ? head + '(' + value + ')' : head
}

/** 解析出正文里全部引用标记（按出现顺序；无匹配返回空数组） */
export function parseReferenceMarkups(text: string): ReferenceMarkup[] {
  const out: ReferenceMarkup[] = []
  if (!text) return out
  // 每次调用都新建正则实例，或把共享实例的 lastIndex 归零 —— 否则连续调用会漏匹配。
  const re = new RegExp(REFERENCE_MARKUP_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ kind: m[1].toLowerCase(), name: m[2], value: m[3] ?? '' })
  }
  return out
}

/** 按种类取名字列表（去重，保序）。用于 skills:[…] / mcpServers:[…] */
export function namesOfKind(text: string, kind: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of parseReferenceMarkups(text)) {
    if (r.kind !== kind || !r.name) continue
    if (seen.has(r.name)) continue
    seen.add(r.name)
    out.push(r.name)
  }
  return out
}

/**
 * 把正文里的标记替换成人类可读/给模型看的纯文本。
 *
 * 有什么用：转录与纯文本展示不想看到 `@[skill:…](…)` 这种机器串时，
 * 换成 `@技能名` 读起来顺眼（技能正文由后端按 kind 决定要不要展开）。
 */
export function stripMarkupToPlain(text: string): string {
  return text.replace(new RegExp(REFERENCE_MARKUP_RE.source, 'g'), (_full, _kind: string, name: string) =>
    '@' + name,
  )
}

/**
 * 「节点引用」载荷的编解码：`<canvasId>#<nodeId>`。
 *
 * 为什么用 `#` 而不是 `/`：画布 id 走 URL 段时会被 encode，而节点 id 只是本地号；
 * `#` 既不会出现在画布 id（安全字符集）也不会出现在节点 id 里，切分无歧义。
 */
export function encodeNodeRef(canvasId: string, nodeId: string): string {
  return (canvasId || '') + '#' + (nodeId || '')
}

export function decodeNodeRef(value: string): { canvasId: string; nodeId: string } {
  const i = (value || '').indexOf('#')
  if (i < 0) return { canvasId: '', nodeId: value || '' }
  return { canvasId: value.slice(0, i), nodeId: value.slice(i + 1) }
}
