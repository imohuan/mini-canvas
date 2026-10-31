/**
 * 组件库的颜色只能来自项目主题。
 *
 * 这条测试守的是“换主题真的会跟着变”：
 *   1. 组件样式里不出现 `--mck-*` 颜色中转（只允许尺寸/圆角/层级/字体）；
 *   2. Provider 不把颜色写进 `:root`（否则嵌进画布会盖掉整套主题）；
 *   3. 预览页的 `--ui-*` 兜底限定在预览容器内，不污染宿主。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../..')

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path, exts))
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path)
  }
  return out
}

const colorTokens = [
  'accent', 'accent-hover', 'danger', 'danger-soft', 'success', 'warning', 'info',
  'ink', 'ink-muted', 'panel', 'panel-soft', 'line', 'hover', 'chip', 'chip-hover', 'shadow',
]
const colorPattern = new RegExp('--mck-(' + colorTokens.join('|') + ')\\b')

describe('ui-kit 主题色单一来源', () => {
  it('组件样式不再用 --mck-* 做颜色中转', () => {
    const offenders = walk(join(src, 'components'), ['.css', '.vue'])
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => colorPattern.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(src.length + 1))
    expect(offenders, '这些文件又引入了组件专属颜色变量').toEqual([])
  })

  it('Provider 不把颜色写进 :root', () => {
    const provider = readFileSync(join(src, 'provider/UiKitProvider.vue'), 'utf-8')
    const config = readFileSync(join(src, 'provider/config.ts'), 'utf-8')
    expect(provider).not.toMatch(/setVar\('--ui-/)
    expect(config).not.toMatch(/setVar\('--ui-/)
    expect(config).toMatch(/themeVars/)
  })

  it('预览页兜底只作用于预览容器', () => {
    const css = readFileSync(join(src, 'preview/preview.css'), 'utf-8')
    expect(css).toMatch(/\.uk-shell[^{]*\{/)
    const rootBlocks = [...css.matchAll(/(^|\n):root\s*\{([^}]*)\}/g)]
    for (const match of rootBlocks) {
      expect(match[2], ':root 里不应再定义 --ui-*').not.toMatch(/--ui-/)
    }
  })
})
