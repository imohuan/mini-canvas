/**
 * webSources —— 从搜索 / 抓取类工具的**输出**里认出引用链接（纯函数，可单测）。
 *
 * 用户口径（2026-11-07）：搜索类结果在对话里应该是「使用了 N 个来源」这一行，
 * 展开能看到每条链接，而不是一堆 JSON。只在输出里真的有链接时才出现。
 */

export interface WebSource {
  url: string
  title?: string
}

/** 只对搜索 / 抓取类工具做链接提取，普通命令的输出不往里塞链接 */
const SEARCHISH = /(^|__)(web_search|search_web|search|fetch|browse|browser|open_url|scrape|crawl)/i

export function isSourceTool(name: string): boolean {
  return SEARCHISH.test(String(name || '').replace(/^mcp__[A-Za-z0-9_-]+__/, ''))
}

/** 只放行 http(s) 链接（javascript: / data: 一律不收） */
function safeUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  if (!/^https?:\/\//i.test(s)) return undefined
  try {
    const u = new URL(s)
    return u.toString()
  } catch {
    return undefined
  }
}

function titleOf(obj: Record<string, unknown>): string | undefined {
  for (const key of ['title', 'name', 'text', 'label', 'headline']) {
    const v = obj[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/** 递归扫 JSON：对象里带 url/href/link 的，连标题一起收 */
function collect(value: unknown, out: WebSource[], depth = 0): void {
  if (!value || depth > 8) return
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  for (const key of ['url', 'href', 'link']) {
    const url = safeUrl(obj[key])
    if (!url) continue
    const title = titleOf(obj)
    out.push(title ? { url, title } : { url })
    break
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') collect(v, out, depth + 1)
  }
}

/**
 * 工具输出 → 去重后的来源列表。
 *
 * 顺序保持输出里的先后（搜索结果本身就是按相关性排的），同一条链接只留第一次。
 */
export function toolSources(name: string, output: string | undefined): WebSource[] {
  if (!output || !isSourceTool(name)) return []
  const out: WebSource[] = []
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    parsed = undefined
  }
  if (parsed !== undefined) collect(parsed, out)
  // 输出可能是带前后缀的文本（「结果：…」这种）：兜底把裸链接也收进来
  if (!out.length) {
    for (const m of output.matchAll(/https?:\/\/[^\s"'<>)}\]]+/g)) {
      const url = safeUrl(m[0])
      if (url) out.push({ url })
    }
  }
  const seen = new Set<string>()
  const deduped: WebSource[] = []
  for (const s of out) {
    if (seen.has(s.url)) continue
    seen.add(s.url)
    deduped.push(s)
  }
  return deduped.slice(0, 20)
}

/** 链接标题的兜底：主机名 */
export function sourceLabel(source: WebSource): string {
  if (source.title) return source.title
  try {
    return new URL(source.url).hostname
  } catch {
    return source.url
  }
}
