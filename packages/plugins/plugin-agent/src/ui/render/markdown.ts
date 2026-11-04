/**
 * markdown —— 极小的 Markdown → HTML（纯函数，零依赖，可单测）。
 *
 * 为什么自己写：模型输出里的代码块与列表混在纯文本里糊成一团，读起来很费劲；
 * 而这个插件要能独立加载（外部单文件 js 场景），不适合再引一个 Markdown 库。
 *
 * **安全是第一位**：先整体转义 HTML，再做最小替换 —— 模型的输出是不可信内容，
 * 直接 v-html 原始文本就是一个 XSS 入口。所以这里永远先 escape，之后所有标签
 * 都是我们自己拼出来的字面量，用户内容里不可能再冒出标签。
 *
 * 支持：**粗体**、`行内代码`、```代码块```、- 列表、# 标题、[文字](链接)、段落与换行。
 */

/** HTML 转义（五个危险字符全部处理） */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 链接协议白名单：只放行 http/https/mailto，挡掉 javascript: 这类 */
function safeHref(raw: string): string | undefined {
  const url = raw.trim()
  if (/^(https?:|mailto:)/i.test(url)) return url
  return undefined
}

/** 行内：粗体 / 行内代码 / 链接（输入已转义） */
function inline(text: string): string {
  let out = text
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => '<code>' + code + '</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, b: string) => '<strong>' + b + '</strong>')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, href: string) => {
    const safe = safeHref(href)
    if (!safe) return label
    return '<a href="' + safe + '" target="_blank" rel="noreferrer noopener">' + label + '</a>'
  })
  return out
}

/**
 * 渲染成 HTML。
 *
 * 先按代码块切段：代码块里的内容**不再**做行内替换（否则代码里的 ** 与 ` 会被吃掉）。
 */
export function renderMarkdown(src: string): string {
  if (!src) return ''
  const escaped = escapeHtml(src)
  const parts = escaped.split(String.fromCharCode(96, 96, 96))
  const html: string[] = []
  parts.forEach((part, i) => {
    const isCode = i % 2 === 1
    if (isCode) {
      // 第一行可能是语言标记（```ts），去掉；内容原样保留（已转义）
      const body = part.replace(/^[a-zA-Z0-9_-]*\n/, '')
      html.push('<pre class="md-code"><code>' + body.replace(/\n$/, '') + '</code></pre>')
      return
    }
    html.push(renderBlocks(part))
  })
  return html.join('')
}

/** 段落 / 标题 / 列表 / 换行 */
function renderBlocks(text: string): string {
  const lines = text.split(String.fromCharCode(10))
  const out: string[] = []
  let list: string[] = []
  let para: string[] = []

  const flushList = (): void => {
    if (!list.length) return
    out.push('<ul class="md-list">' + list.map((li) => '<li>' + li + '</li>').join('') + '</ul>')
    list = []
  }
  const flushPara = (): void => {
    if (!para.length) return
    out.push('<p class="md-p">' + para.join('<br>') + '</p>')
    para = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
    if (heading) {
      flushList()
      flushPara()
      const level = heading[1].length
      out.push('<h' + level + ' class="md-h">' + inline(heading[2]) + '</h' + level + '>')
      continue
    }
    if (bullet) {
      flushPara()
      list.push(inline(bullet[1]))
      continue
    }
    if (!trimmed) {
      flushList()
      flushPara()
      continue
    }
    flushList()
    para.push(inline(line))
  }
  flushList()
  flushPara()
  return out.join('')
}
