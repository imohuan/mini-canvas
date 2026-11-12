/**
 * 读一个 Vue 单文件组件，并把它的外部样式一起拼进来。
 *
 * 样式从 SFC 移到同目录 CSS 后（`<style scoped src="./X.css">`），运行行为不变，
 * 但「读源码找样式规则」的契约测试只能看到模板与脚本。这个 helper 只补充 SFC
 * 真正会加载的同目录样式，断言与选择器保持原样。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

// 只匹配「单独成文件」的样式标签：<style scoped src="./X.css"></style>。
// 不要匹配源码里的写法说明（如 \`<style src="./X.css">\`），否则会把后面的 CSS 一起吞掉。
const STYLE_SRC = /<style\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/style>/g
const EXTERNAL_STYLE_SRC = /<style\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/style>/g

export function readSfcWithStyles(file: string): string {
  const source = readFileSync(file, 'utf8')
  const dir = path.dirname(file)
  // 外部样式按 SFC 里 <style src> 的位置替换成内联块，保留「scoped 块 → 全局块」的顺序。
  return source.replace(EXTERNAL_STYLE_SRC, (tag, rel: string) => {
    if (!rel.startsWith('./') && !rel.startsWith('../')) return tag
    const scoped = /\bscoped\b/.test(tag) ? ' scoped' : ''
    return '<style' + scoped + '>\n' + readFileSync(path.resolve(dir, rel), 'utf8') + '\n</style>'
  })
}
