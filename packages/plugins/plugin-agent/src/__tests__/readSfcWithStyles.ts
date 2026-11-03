/**
 * 读一个 Vue 单文件组件，并把它的外部样式一起拼进来。
 *
 * 为什么需要：样式从 SFC 移到同目录 CSS 后（`<style scoped src="./X.css">`），
 * 运行行为完全不变，但一批「读源码找样式规则」的契约测试只能看到模板与脚本，
 * 会把规则当成丢失。这个 helper 只负责把 SFC 真正会加载的样式也读出来，
 * 测试里的断言与选择器保持原样。
 *
 * 只解析同目录相对路径，避免测试无意间读到仓库外的文件。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const STYLE_SRC = /<style\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/style>/g

export function readSfcWithStyles(file: string): string {
  const source = readFileSync(file, 'utf8')
  const dir = path.dirname(file)
  const styles: string[] = []
  for (const match of source.matchAll(STYLE_SRC)) {
    const rel = match[1]
    if (!rel.startsWith('./') && !rel.startsWith('../')) continue
    styles.push(readFileSync(path.resolve(dir, rel), 'utf8'))
  }
  return styles.length ? source + '\n' + styles.join('\n') : source
}
