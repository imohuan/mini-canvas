/**
 * 导出图片时的字体内联。
 *
 * 为什么不用 html-to-image 自带的 getFontEmbedCSS：
 * 它会把页面上**所有** @font-face 规则都抓下来转 dataURL。中文站点的 Google Fonts
 * 一张表就有 400 个分片（unicode-range 子集），整套内联要下载几十 MB、日志里还会
 * 因为读不到跨域表 cssRules 刷出 SecurityError；在画布上表现为「正在导出…」卡很久。
 *
 * 这里改成：先读出画布 DOM 里每个元素算出来的字体和它真正渲染的文字，再只挑
 * 「字体名对得上 + unicode-range 覆盖到这些字」的 @font-face 分片内联。
 * 抓取失败的单个分片直接跳过（退回系统字体），不影响导出。
 */

/** 单次导出内联字体分片的上限：足够覆盖常用中英文，又不会把主线程拖住 */
export const MAX_EMBED_FACES = 24

export interface FontFaceRule {
  family: string
  weight: string
  style: string
  display: string
  /** 源码里的 url(...)（绝对地址或相对地址） */
  src: string
  /** 首个 url() 的 format(...)，缺省为空 */
  format: string
  /** 解析后的 unicode-range；空数组 = 不限字符（按使用情况保留） */
  unicodeRanges: Array<[number, number]>
  unicodeRangeText: string
}

export interface SelectedFontFace {
  face: FontFaceRule
  /** 这张分片覆盖到多少个本次用到的字符（越高越优先） */
  matched: number
}

function firstMatch(block: string, re: RegExp): string {
  return (re.exec(block)?.[1] ?? '').trim()
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

/** 解析 unicode-range 文本："U+0000-00FF, U+0131, U+4??" */
export function parseUnicodeRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const raw of text.split(',')) {
    const token = raw.trim()
    const m = /^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i.exec(token)
    if (!m) continue
    const startText = m[1] ?? ''
    if (startText.includes('?')) {
      const lo = parseInt(startText.replace(/\?/g, '0'), 16)
      const hi = parseInt(startText.replace(/\?/g, 'F'), 16)
      if (Number.isFinite(lo) && Number.isFinite(hi)) out.push([lo, hi])
      continue
    }
    const lo = parseInt(startText, 16)
    const hi = m[2] ? parseInt(m[2], 16) : lo
    if (Number.isFinite(lo) && Number.isFinite(hi)) out.push([lo, hi])
  }
  return out
}

/** 从一个 url() 里拆出地址与 format() */
function parseSrc(value: string): { src: string; format: string } {
  const src = firstMatch(value, /url\(\s*['"]?([^'")]+)['"]?\s*\)/i)
  const format = unquote(firstMatch(value, /format\(\s*['"]?([^'")]+)['"]?\s*\)/i))
  return { src, format }
}

/** 把一段 CSS 文本拆成 @font-face 规则（只认顶层声明；其它规则忽略） */
export function parseFontFaceCss(cssText: string): FontFaceRule[] {
  const out: FontFaceRule[] = []
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, '')
  const re = /@font-face\s*\{([\s\S]*?)\}/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    const block = m[1] ?? ''
    const family = unquote(firstMatch(block, /font-family\s*:\s*([^;]+);/i))
    const srcValue = firstMatch(block, /src\s*:\s*([^;]+);/i)
    const { src, format } = parseSrc(srcValue)
    if (!family || !src) continue
    const unicodeRangeText = firstMatch(block, /unicode-range\s*:\s*([^;]+);/i)
    out.push({
      family,
      weight: firstMatch(block, /font-weight\s*:\s*([^;]+);/i) || '400',
      style: firstMatch(block, /font-style\s*:\s*([^;]+);/i) || 'normal',
      display: firstMatch(block, /font-display\s*:\s*([^;]+);/i) || 'swap',
      src,
      format,
      unicodeRanges: parseUnicodeRanges(unicodeRangeText),
      unicodeRangeText,
    })
  }
  return out
}

function normalizeFamily(family: string): string {
  return unquote(family).replace(/\s+/g, ' ').trim().toLowerCase()
}

function countMatched(ranges: Array<[number, number]>, chars: ReadonlySet<number>): number {
  let n = 0
  for (const ch of chars) {
    if (ranges.some(([lo, hi]) => ch >= lo && ch <= hi)) n++
  }
  return n
}

/**
 * 从全部 @font-face 里挑出本次导出需要内联的分片。
 *
 * @param faces 页面上的全部 @font-face
 * @param usedFamilies 画布上实际用到的字体名（小写、已去引号）
 * @param usedChars 画布上实际出现的字符码点
 * @param limit 上限（超了按时命中字符数优先，避免一次抓几百个文件）
 */
export function selectFontFaces(
  faces: readonly FontFaceRule[],
  usedFamilies: ReadonlySet<string>,
  usedChars: ReadonlySet<number>,
  limit = MAX_EMBED_FACES,
): SelectedFontFace[] {
  const picked: SelectedFontFace[] = []
  const seen = new Set<string>()
  for (const face of faces) {
    if (!usedFamilies.has(normalizeFamily(face.family))) continue
    // 同一字体家族同一字重通常有多个分片（中文 Google Fonts 有 400 个），按字重去重
    // 会把不同字的覆盖范围误删；只有 **路径完全一致** 才算同一份文件。
    const dedupeKey = normalizeFamily(face.family) + '|' + face.weight + '|' + face.style + '|' + face.src
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    let matched: number
    if (face.unicodeRanges.length === 0) {
      // 没有 unicode-range 的字体（自托管 woff2 常见）无法细分：用到这个字体就保留
      matched = 1
    } else {
      matched = countMatched(face.unicodeRanges, usedChars)
      if (matched === 0) continue
    }
    picked.push({ face, matched })
  }
  picked.sort((a, b) => b.matched - a.matched)
  return picked.slice(0, Math.max(0, limit))
}

/** 生成可直接塞进导出克隆的 @font-face CSS（src 已换成 dataURL） */
export function buildFontFaceCss(
  picked: readonly SelectedFontFace[],
  dataUrls: ReadonlyMap<string, string>,
): string {
  const blocks: string[] = []
  for (const { face } of picked) {
    const dataUrl = dataUrls.get(face.src)
    if (!dataUrl) continue
    const format = face.format ? " format('" + face.format + "')" : ''
    blocks.push(
      '@font-face{font-family:' + JSON.stringify(face.family) +
        ';font-style:' + face.style +
        ';font-weight:' + face.weight +
        ';font-display:' + face.display +
        ';src:url(' + dataUrl + ')' + format +
        (face.unicodeRangeText ? ';unicode-range:' + face.unicodeRangeText : '') +
        '}',
    )
  }
  return blocks.join('\n')
}
