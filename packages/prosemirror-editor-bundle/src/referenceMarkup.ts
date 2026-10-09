/**
 * referenceMarkup —— 输入框里「引用标记」的唯一格式与纯解析（零 DOM、零 Vue，可单测）。
 *
 * 格式（用户口径 2026-10-08：改用 **XML 元素标签**，字段化携带完整信息，
 * 让 AI / 外部 Agent（Codex 等）拿到就能理解、能直接读取，不再依赖后端翻译）：
 *
 *   <ref type="skill" name="archify" path="D:/.../skills/archify/SKILL.md" />
 *   <ref type="mcp" name="smart" />
 *   <ref type="node" name="花海" canvasId="430c8f1f" nodeId="35" />
 *   <ref type="asset" name="图片 18.png" path="D:/.../assets/files/ab.png" ext="png" />
 *
 * 字段表：
 *   type     引用种类（skill / mcp / node / asset）
 *   name     展示名（技能名 / 服务名 / 节点标题 / 资产名）
 *   path     本机绝对路径（skill 的说明书 / asset 的文件；MCP 无）
 *   ext      资产的扩展名（png / jpeg / mp4 / mp3…；**目录资产没有此字段**）
 *   canvasId + nodeId   画布节点的定位（两段拼起来才是完整地址）
 *   folderId 资产所在**资产库文件夹**的 id（文件夹引用必有；文件引用有则带上）
 *
 * 转录（会话历史）里存的就是这个 XML 原文 —— 于是「编辑回填」时 parsePlainTextToContent
 * 能把它还原成输入框的 chip 标签（此前降级成 @名字，回填后标签就丢了，用户报过）。
 * 展示（气泡里渲染）也直接用 XML 还原：不再需要「按 @名字 + 已装清单」猜测回推。
 */

/** 引用种类 */
export type RefKind = 'asset' | 'node' | 'skill' | 'mcp'

/**
 * 四类引用的**内联 SVG 图标**（唯一一份）。
 *
 * 为什么住这里、而不是各消费方自己写：标签由 ProseMirror 直接造 DOM 渲染，拿不到 Vue 组件实例，
 * 图标只能是字符串；而「解析回填」与「@ 菜单 / 右键插入」必须长得一模一样，
 * 各存一份必然漂移（审查发现过：回填造的标签与右键插入的标签外观不一致）。
 * 上游（本包）持有，下游（插件）从这里取。
 */
export const REF_ICONS: Record<RefKind, string> = {
  asset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
  node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>',
  skill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14.622 17.897-10.68-2.913"/><path d="M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z"/><path d="M9 8c-1.804 2.71-3.97 3.46-6 3.5m2 8c.5-1.5 1.5-2.5 3-3"/></svg>',
  mcp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>',
}

/** 一个引用标记（解析结果）；字段按 kind 各取所需，统一摊平方便消费方读取 */
export interface ReferenceMarkup {
  type: RefKind
  name: string
  path?: string
  ext?: string
  canvasId?: string
  nodeId?: string
  folderId?: string
}

/** XML 属性值转义（只处理会影响解析的三个字符；其余照原样） */
function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
/** XML 属性值反转义 */
function unesc(v: string): string {
  return v.replace(/&lt;/g, '<').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

/** 资产引用额外字段：ext（文件扩展名）/ folderId（所在资产库文件夹） */
export interface RefAssetExtra {
  ext?: string
  folderId?: string
}

/**
 * 把一份引用序列化成 XML 元素。字段按 kind 各取所需（没有的字段不输出，保持最小）。
 *
 * asset 的 `value` 是**本机绝对路径**；`extra.ext` 与 `extra.folderId` 有就带上 ——
 * 前者让「点标签预览」知道该用哪个预览器，后者让「文件夹被删/改名后仍能定位」。
 */
export function formatReferenceMarkup(kind: string, name: string, value?: string, extra?: RefAssetExtra): string {
  const type = kind.toLowerCase()
  if (type === 'node' && value) {
    const { canvasId, nodeId } = decodeNodeRef(value)
    return '<ref type="node" name="' + esc(name) + '" canvasId="' + esc(canvasId) + '" nodeId="' + esc(nodeId) + '" />'
  }
  if (type === 'asset') {
    return '<ref type="asset" name="' + esc(name) + '"'
      + (value ? ' path="' + esc(value) + '"' : '')
      + (extra?.ext ? ' ext="' + esc(extra.ext) + '"' : '')
      + (extra?.folderId ? ' folderId="' + esc(extra.folderId) + '"' : '')
      + ' />'
  }
  return '<ref type="' + esc(type) + '" name="' + esc(name) + '"' + (value ? ' path="' + esc(value) + '"' : '') + ' />'
}

/** 与 formatReferenceMarkup 等价、但字段化传参（node 用它，避免拼 # 再解回来） */
export function formatRefNode(name: string, canvasId: string, nodeId: string): string {
  return '<ref type="node" name="' + esc(name) + '" canvasId="' + esc(canvasId) + '" nodeId="' + esc(nodeId) + '" />'
}
/** asset 的字段化序列化（path 必有；ext 可选）。等价于 formatReferenceMarkup('asset', …)。 */
export function formatRefAsset(name: string, path: string, ext?: string): string {
  return '<ref type="asset" name="' + esc(name) + '" path="' + esc(path) + '"' + (ext ? ' ext="' + esc(ext) + '"' : '') + ' />'
}

/**
 * 解析正文里全部引用标记（按出现顺序；无匹配返回空数组）。
 * 只认 XML 形式（不做旧格式兼容 —— 用户拍板：直接完整切换）。
 */
export const REFERENCE_MARKUP_RE = /<ref\b[^>]*\/>/g

const ATTR_RE = /(\w+)="([^"]*)"/g

export function parseReferenceMarkups(text: string): ReferenceMarkup[] {
  const out: ReferenceMarkup[] = []
  if (!text) return out
  const re = new RegExp(REFERENCE_MARKUP_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const attrs: Record<string, string> = {}
    let a: RegExpExecArray | null
    const are = new RegExp(ATTR_RE.source, 'g')
    while ((a = are.exec(m[0])) !== null) attrs[a[1]] = unesc(a[2])
    const type = (attrs.type || '').toLowerCase()
    if (type !== 'skill' && type !== 'mcp' && type !== 'node' && type !== 'asset') continue
    out.push({
      type: type as RefKind,
      name: attrs.name || '',
      ...(attrs.path ? { path: attrs.path } : {}),
      ...(attrs.ext ? { ext: attrs.ext } : {}),
      ...(attrs.canvasId ? { canvasId: attrs.canvasId } : {}),
      ...(attrs.nodeId ? { nodeId: attrs.nodeId } : {}),
      ...(attrs.folderId ? { folderId: attrs.folderId } : {}),
    })
  }
  return out
}

/** 按种类取名字列表（去重，保序）。用于 skills:[…] / mcpServers:[…] / MCP 合并 */
export function namesOfKind(text: string, kind: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of parseReferenceMarkups(text)) {
    if (r.type !== kind || !r.name) continue
    if (seen.has(r.name)) continue
    seen.add(r.name)
    out.push(r.name)
  }
  return out
}

/**
 * 把正文里的引用标记剥成「@名字」—— **只用于极少数「纯展示」场景**（会话标题、分支标题）。
 * 转录里不再降级（改存 XML 原文，编辑回填靠它还原 chip）。
 */
export function stripMarkupToPlain(text: string): string {
  return text.replace(new RegExp(REFERENCE_MARKUP_RE.source, 'g'), (full) => {
    const m = parseReferenceMarkups(full)[0]
    return m ? '@' + m.name : full
  })
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
