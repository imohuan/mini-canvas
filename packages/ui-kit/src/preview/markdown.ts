/**
 * 组件文档用的 Markdown 解析器。
 *
 * 普通段落、标题、列表、表格渲染成安全 HTML；@@VUE@@ … @@ENDVUE@@ 里的示例单独抽出来，
 * 交给 Vite 的 SFC 编译插件处理，避免整篇文档进 v-html。
 */

export type MarkdownBlock =
  | { type: 'html'; html: string }
  | { type: 'code'; source: string; lang: string; exampleIndex: number; codeIndex: number }

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const LANG_LABELS: Record<string, string> = {
  vue: 'Vue',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  bash: 'Bash',
  sh: 'Bash',
  shell: 'Bash',
  md: 'Markdown',
  markdown: 'Markdown',
  text: 'Text',
}

/** 代码块右上角显示的语言名：认识的写常用写法，其余只把首字母大写。 */
export function codeLangLabel(lang: string): string {
  const key = lang.trim().toLowerCase()
  if (!key) return 'Text'
  return LANG_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
}

function safeHref(raw: string): string | undefined {
  const url = raw.trim()
  return /^(https?:|mailto:)/i.test(url) ? url : undefined
}

function inline(text: string): string {
  let out = text.replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, href: string) => {
    const safe = safeHref(href)
    return safe
      ? `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`
      : label
  })
  return out
}

interface ListState {
  kind: 'ul' | 'ol'
  items: string[]
}

function listHtml(list: ListState): string {
  const tag = list.kind
  return `<${tag}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`
}

/** 表格：一行表头、一行分隔线、若干数据行；单元格已由调用方转义。 */
function tableFromLines(lines: string[]): string {
  const rows = lines
    .map((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => inline(cell.trim())))
  const body = rows.slice(2)
  const head = rows[0] ?? []
  return '<table><thead><tr>'
    + head.map((cell) => `<th>${cell}</th>`).join('')
    + '</tr></thead><tbody>'
    + body.map((row) => '<tr>' + row.map((cell) => `<td>${cell}</td>`).join('') + '</tr>').join('')
    + '</tbody></table>'
}

function renderMarkdownBody(source: string): string {
  const lines = source.split(/\r?\n/)
  const html: string[] = []
  let paragraph: string[] = []
  let list: ListState | undefined
  let table: string[] | undefined

  const pushList = (): void => {
    if (!list) return
    html.push(listHtml(list))
    list = undefined
  }
  const pushTable = (): void => {
    if (!table) return
    if (table.length >= 3) html.push(tableFromLines(table))
    table = undefined
  }
  const flush = (): void => {
    if (paragraph.length > 0) {
      html.push(`<p>${paragraph.join('<br>')}</p>`)
      paragraph = []
    }
    pushList()
    pushTable()
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    const unordered = /^[-*]\s+(.*)$/.exec(trimmed)
    const ordered = /^\d+\.\s+(.*)$/.exec(trimmed)

    if (heading) {
      flush()
      const level = heading[1].length
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }
    if (unordered || ordered) {
      pushTable()
      if (paragraph.length > 0) {
        html.push(`<p>${paragraph.join('<br>')}</p>`)
        paragraph = []
      }
      const kind = unordered ? 'ul' : 'ol'
      if (!list || list.kind !== kind) {
        pushList()
        list = { kind, items: [] }
      }
      list.items.push(inline((unordered ?? ordered)?.[1] ?? ''))
      continue
    }
    if (trimmed.startsWith('> ')) {
      flush()
      html.push(`<blockquote>${inline(trimmed.slice(2))}</blockquote>`)
      continue
    }
    if (trimmed.startsWith('|')) {
      if (paragraph.length > 0) {
        html.push(`<p>${paragraph.join('<br>')}</p>`)
        paragraph = []
      }
      pushList()
      table = [...(table ?? []), trimmed]
      continue
    }
    if (!trimmed) {
      flush()
      continue
    }
    pushList()
    pushTable()
    paragraph.push(inline(line))
  }
  flush()
  return html.join('')
}

/**
 * 把 @@VUE@@ 示例和普通 Markdown 代码块都抽出来。
 *
 * 代码块只保留源文本和语言名；真正的高亮由 Vite 插件在构建期生成，
 * 页面运行时不会加载 Shiki，也不会执行文档里的代码。
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  if (!source.trim()) return []
  const blocks: MarkdownBlock[] = []
  const pattern = /@@VUE@@\n([\s\S]*?)@@ENDVUE@@|```([\w-]*)\n([\s\S]*?)```/g
  let cursor = 0
  let match: RegExpExecArray | null
  let exampleIndex = 0
  let codeIndex = 0

  while ((match = pattern.exec(source))) {
    const before = source.slice(cursor, match.index)
    if (before.trim()) blocks.push({ type: 'html', html: renderMarkdownBody(escapeHtml(before)) })
    if (match[1] !== undefined) {
      blocks.push({ type: 'code', source: match[1], lang: 'vue', exampleIndex: exampleIndex++, codeIndex: codeIndex++ })
    } else {
      blocks.push({ type: 'code', source: match[3] ?? '', lang: match[2] || 'text', exampleIndex: -1, codeIndex: codeIndex++ })
    }
    cursor = match.index + match[0].length
  }
  const tail = source.slice(cursor)
  if (tail.trim()) blocks.push({ type: 'html', html: renderMarkdownBody(escapeHtml(tail)) })
  return blocks
}
