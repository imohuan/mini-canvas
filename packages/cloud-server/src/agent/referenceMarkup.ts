/**
 * referenceMarkup（服务端一份）—— 解析用户消息里的**引用标记**。
 *
 * 与前端 prosemirror-editor-bundle/src/referenceMarkup.ts 同一套格式（有意各存一份，
 * cloud-server 要能独立 npx 跑）。两份由测试逐字比对守住。
 *
 * 格式（用户口径 2026-10-08：XML 元素标签，字段化携带完整信息，后端**原样转发**不翻译）：
 *
 *   <ref type="skill" name="archify" path="D:/.../SKILL.md" />
 *   <ref type="node" name="花海" canvasId="430c8f1f" nodeId="35" />
 *   <ref type="asset" name="图片 18.png" path="D:/.../ab.png" ext="png" />
 *   <ref type="mcp" name="canvas" />
 */

export type RefKind = 'asset' | 'node' | 'skill' | 'mcp'

export interface ReferenceMarkup {
  type: RefKind
  name: string
  path?: string
  ext?: string
  canvasId?: string
  nodeId?: string
  folderId?: string
}

/** 自闭合 <ref ... /> 元素（**只认 XML 形式**；用户拍板：不做旧格式兼容） */
export const REFERENCE_MARKUP_SOURCE = '<ref\\b[^>]*\\/>'

const ATTR_SOURCE = '(\\w+)="([^"]*)"'

export function parseReferenceMarkups(text: string): ReferenceMarkup[] {
  const out: ReferenceMarkup[] = []
  if (!text) return out
  const re = new RegExp(REFERENCE_MARKUP_SOURCE, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const attrs: Record<string, string> = {}
    let a: RegExpExecArray | null
    const are = new RegExp(ATTR_SOURCE, 'g')
    while ((a = are.exec(m[0])) !== null) attrs[a[1]] = a[2]
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

/** 取某一种引用的名字（去重保序）。用于 skills / mcpServers / MCP 合并 */
export function namesOfKind(text: string, kind: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of parseReferenceMarkups(text)) {
    if (r.type !== kind || !r.name || seen.has(r.name)) continue
    seen.add(r.name)
    out.push(r.name)
  }
  return out
}

/** 引用标记剥成「@名字」。**只用于标题等纯展示场景**（转录里改存 XML 原文） */
export function stripMarkupToPlain(text: string): string {
  const re = new RegExp(REFERENCE_MARKUP_SOURCE, 'g')
  return text.replace(re, (full) => {
    const m = parseReferenceMarkups(full)[0]
    return m ? '@' + m.name : full
  })
}

/** 节点引用载荷 <canvasId>#<nodeId> 解码 */
export function decodeNodeRef(value: string): { canvasId: string; nodeId: string } {
  const i = (value || '').indexOf('#')
  if (i < 0) return { canvasId: '', nodeId: value || '' }
  return { canvasId: value.slice(0, i), nodeId: value.slice(i + 1) }
}

/** 组装用户消息正文：**原样透传**（不翻译；含义由系统提示词的 REFERENCE_MARKUP_GUIDE 说明） */
export function buildReferenceGuidance(text: string): string {
  return text
}

/**
 * 引用标记的**含义说明**（写进系统提示词一次，而不是每条消息翻译一遍）。
 *
 * 为什么不翻译（用户口径 2026-10-06/08）：
 *   用户会把输入框里的内容**复制到本机 Agent**（Codex 等）接着用 —— 后端翻译了对方就看不懂。
 *   标记本身已是**字段化的 XML**（自带本机绝对路径），模型直接可读；说明写一次即可。
 */
export const REFERENCE_MARKUP_GUIDE = [
  '## 引用标记（引用元素）',
  '',
  '用户消息里可能出现 <ref ... /> 形式的引用元素（也可能被复制到别处继续使用）。含义：',
  '',
  '- <ref type="asset" name="…" path="/abs/path.png" ext="png" /> —— 资产**文件**。path 是**本机绝对路径**，ext 是扩展名。需要看图时直接按 path 读取（不要当 URL、不要猜别的路径）。',
  '- <ref type="asset" name="…" path="/abs/dir" folderId="…" /> 或 <ref type="asset" name="…" folderId="…" /> —— 资产**文件夹**（一堆资产的目录）。**没有 ext 就是目录**。path（有的话）是里面资产的公共目录，可以直接 ls。folderId 是资产库里的文件夹 id，属于界面内部标识，不用管它。',
  '- <ref type="node" name="…" canvasId="…" nodeId="…" /> —— 画布节点。用画布 MCP 工具按 canvasId + nodeId 读取，不要用本地文件去猜它的资源路径。',
  '- <ref type="skill" name="…" path="/abs/path/SKILL.md" /> —— 技能。需要时打开这份说明书再照做。',
  '- <ref type="mcp" name="…" /> —— MCP 服务（已按名字连好，不需要额外动作）。',
  '',
  '标记里的路径都是本机绝对路径，可直接读取。',
].join(String.fromCharCode(10))
