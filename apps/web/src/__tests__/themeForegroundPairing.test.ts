/**
 * 前景色与底色必须成对使用（dark 主题下最容易看出的漂移）。
 *
 * 真实缺陷：`--ui-primary-ink` 是 `--ui-primary-bg` 的配套文字色，暗色下是深色；
 * 把它用到 `--ui-accent` 的实心按钮上，按钮文字就会在暗色主题里变黑。
 * 这类错误在亮色下往往还能看，只会在暗色下暴露，所以用规则扫描收口。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const SCAN_DIRS = ['packages/plugins', 'packages/canvas-render', 'packages/ui', 'packages/ui-kit-shadcn'].map((p) =>
  path.join(REPO_ROOT, ...p.split('/')),
)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/[.](vue|css)$/.test(name)) out.push(full)
  }
  return out
}

function styleSources(src: string, isVue: boolean): string[] {
  if (!isVue) return [src]
  const out: string[] = []
  const re = /<style[^>]*>([\s\S]*?)<\/style>/g
  let match: RegExpExecArray | null
  while ((match = re.exec(src))) out.push(match[1] ?? '')
  return out
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function declarations(body: string): Array<[string, string]> {
  return body.split(';').flatMap((part) => {
    const i = part.indexOf(':')
    if (i < 0) return []
    return [[part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()] as [string, string]]
  })
}

function hasToken(value: string, token: string): boolean {
  return new RegExp('(^|[^-\\w])' + token + '(?![\\w-])').test(value)
}

interface Violation {
  file: string
  selector: string
  background: string
  color: string
}

function scan(): { violations: Violation[]; rules: number } {
  const violations: Violation[] = []
  let rules = 0
  for (const dir of SCAN_DIRS) {
    for (const full of walk(dir)) {
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/')
      const isVue = full.endsWith('.vue')
      for (const raw of styleSources(readFileSync(full, 'utf-8'), isVue)) {
        const css = stripComments(raw)
        const re = /([^{}]+)\{([^{}]*)\}/g
        let match: RegExpExecArray | null
        while ((match = re.exec(css))) {
          const selector = (match[1] ?? '').trim().replace(/\s+/g, ' ')
          const body = match[2] ?? ''
          if (!selector || !body.trim()) continue
          rules++
          const decls = declarations(body)
          const bg = decls.find(([prop]) => prop === 'background' || prop === 'background-color')?.[1] ?? ''
          const fg = decls.find(([prop]) => prop === 'color')?.[1] ?? ''
          if (!bg || !fg) continue

          // 实心强调色 / 危险色底：必须用“主题色上的文字”，不能用反色主按钮的前景色。
          const solidAccent = hasToken(bg, '--ui-accent') || hasToken(bg, '--ui-danger')
          if (solidAccent && hasToken(fg, '--ui-primary-ink')) {
            violations.push({ file: rel, selector, background: bg, color: fg })
          }

          // 反向也拦：反色主按钮底不能配“强调色上的白字”。
          if (hasToken(bg, '--ui-primary-bg') && hasToken(fg, '--ui-on-accent')) {
            violations.push({ file: rel, selector, background: bg, color: fg })
          }
        }
      }
    }
  }
  return { violations, rules }
}

describe('前景色与底色成对使用', () => {
  it('实心强调色/危险色底上不写 --ui-primary-ink', () => {
    const { violations, rules } = scan()
    const report = violations
      .slice(0, 80)
      .map((v) => `  ${v.file}  ${v.selector}\n    background: ${v.background}\n    color: ${v.color}`)
      .join('\n')
    expect(rules, '没有扫到 CSS 规则，扫描路径可能写错了').toBeGreaterThan(100)
    expect(violations.length, `发现 ${violations.length} 处前景色与底色不配对：\n${report}`).toBe(0)
  })
})
