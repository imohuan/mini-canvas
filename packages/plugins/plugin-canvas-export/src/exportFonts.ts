/**
 * 导出前把「画布真正用到的字体」抓成 dataURL 并拼成 fontEmbedCSS。
 *
 * 与 html-to-image 的 getFontEmbedCSS 的区别：
 * - 只读**同源**样式表与<style>，跨域表（Google Fonts 的 <link>）用 fetch 读源码再解析，
 *   不再直接碰 sheet.cssRules —— 那条路在跨域表上必然抛 SecurityError 并刷控制台 error；
 * - 只内联本画布 DOM 实际用到的字体家族 + 实际出现的字符覆盖到的分片，
 *   中文 Google Fonts 有 400 个分片，全抓会卡住导出；
 * - 单个分片抓取失败只跳过它，整次导出照常进行。
 */
import {
  MAX_EMBED_FACES,
  buildFontFaceCss,
  parseFontFaceCss,
  selectFontFaces,
  type FontFaceRule,
} from './fontEmbed'

/** 抓单张字体分片的超时（毫秒）：网络慢时宁可退回系统字体，也不卡住导出 */
const FETCH_TIMEOUT_MS = 8000

/** 收集画布 DOM 里实际用到的字体名与字符（跳过 svg 内的 <text> 以外的不可见结构无妨） */
export function collectUsedFonts(root: HTMLElement): { families: Set<string>; chars: Set<number> } {
  const families = new Set<string>()
  const chars = new Set<number>()
  const view = root.ownerDocument.defaultView
  if (!view) return { families, chars }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node: Node | null = walker.currentNode
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? ''
      for (const ch of text) {
        const code = ch.codePointAt(0)
        if (code !== undefined && !/\s/.test(ch)) chars.add(code)
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement
      // SVG 元素没有 style.fontFamily；用计算样式取即可（浏览器对 svg 也返回 CSS 值）
      const family = view.getComputedStyle(el).fontFamily
      for (const part of family.split(',')) {
        const name = part.replace(/^['"]|['"]$/g, '').trim()
        // 通用族（sans-serif / serif / monospace / system-ui…）没有 @font-face，跳过
        if (name && !/^[a-z-]+$/i.test(name)) families.add(name.toLowerCase())
      }
    }
    node = walker.nextNode()
  }
  return { families, chars }
}

/** 读取一个样式表的源码：同源表直接取 cssRules，跨域表 fetch href */
async function readSheetText(sheet: CSSStyleSheet): Promise<string> {
  try {
    const rules = sheet.cssRules
    if (rules) return Array.from(rules).map((r) => r.cssText).join('\n')
  } catch {
    // 跨域：读不到 cssRules，走 fetch
  }
  if (!sheet.href) return ''
  try {
    const res = await withTimeout(fetch(sheet.href), FETCH_TIMEOUT_MS)
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await withTimeout(fetch(url), FETCH_TIMEOUT_MS)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function resolveSrc(src: string, base: string | null): string | null {
  try {
    return new URL(src, base ?? document.baseURI).href
  } catch {
    return null
  }
}

/**
 * 导出用入口：返回可传给 html-to-image 的 fontEmbedCSS。
 * 返回空字符串表示没有可内联的字体（调用方应传 skipFonts 而不是让它自己再抓一遍）。
 */
export async function buildExportFontCss(root: HTMLElement): Promise<string> {
  if (typeof document === 'undefined' || typeof fetch !== 'function') return ''
  const { families, chars } = collectUsedFonts(root)
  if (families.size === 0 || chars.size === 0) return ''

  const sheets = Array.from(document.styleSheets)
  if (sheets.length === 0) return ''
  const texts = await Promise.all(
    sheets.map(async (sheet) => ({ sheet, text: await readSheetText(sheet) })),
  )

  const faces: FontFaceRule[] = []
  for (const { sheet, text } of texts) {
    if (!text) continue
    for (const face of parseFontFaceCss(text)) {
      const abs = resolveSrc(face.src, sheet.href)
      if (abs) faces.push({ ...face, src: abs })
    }
  }
  if (faces.length === 0) return ''

  const picked = selectFontFaces(faces, families, chars, MAX_EMBED_FACES)
  if (picked.length === 0) return ''

  const urls = [...new Set(picked.map((x) => x.face.src))]
  const dataUrls = new Map<string, string>()
  await Promise.all(
    urls.map(async (url) => {
      const dataUrl = await fetchAsDataUrl(url)
      if (dataUrl) dataUrls.set(url, dataUrl)
    }),
  )
  return buildFontFaceCss(picked, dataUrls)
}
