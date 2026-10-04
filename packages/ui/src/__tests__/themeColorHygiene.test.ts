/**
 * 主题配色卫生检查 —— 全仓插件里"写死的颜色"在这里收口。
 *
 * 为什么需要一条自动化守卫（而不是照文档清单人工改一轮）：
 * 写死颜色在亮色主题下看不出问题，**只在暗色下暴露**（白底黑字糊在暗画布上）。
 * 人工改一轮之后，下一个新组件又会写死一两个 —— 这类"慢慢长回来"的漂移只能靠测试挡住。
 * 规范见 `docs/代码开发/主题与配色.md`。
 *
 * 判定口径（有意可解释、可争论，不搞黑魔法）：
 * - **合法**：`var(--token, <兜底色>)` 里的兜底 —— 脱离主题表单独渲染（单测/Storybook/别的宿主）不崩；
 * - **合法**：注释里的颜色、`transparent` / `currentColor` / `inherit` 这类关键字；
 * - **合法**：纯函数里的几何/画布绘制常量（黑名单文件，见下）；
 * - **违规**：一条 CSS 声明里直接给颜色字面量（没有 var()）、TS/JS 里的颜色字面量、内联 :style 绑定的颜色。
 *
 * 白名单用**精确到行的 `file:line` 注释标记**，而不是整文件豁免 ——
 * 整文件豁免会让"这个文件以后随便写"，精确标记才逼着每处写清为什么要写死。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
/** 扫描范围：插件库 + 渲染层 + 成品应用壳（这三处才是"界面配色"的所在地） */
const SCAN_DIRS = ['packages/plugins', 'packages/canvas-render', 'packages/ui'].map((p) =>
  path.join(REPO_ROOT, ...p.split('/')),
)
/** 主题定义真源：这里**就是**色板本身，出现颜色字面量是它的职责。
 *  colorAssets.ts 是内嵌 SVG 贴图素材库（艺术资源自带的填色），性质同「真源」——
 *  素材配色不是界面主题色，改主题也不该跟着变。 */
const EXEMPT_FILES = [
  'packages/canvas-render/src/contracts/themePalette.ts',
  'packages/plugins/plugin-cursor-effect/src/colorAssets.ts',
]

/** 颜色字面量：hex（3/4/6/8 位）或 rgb()/rgba()/hsl()/hsla() */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/g

/** 这些行允许写死颜色：在行尾加 `主题色白名单: 原因` 即可（原因必填，写不清就别豁免） */
const ALLOW_MARK = '主题色白名单'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(vue|ts)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full)
  }
  return out
}

/** 去掉注释后再判颜色（注释里的色值不算违规；也避免把说明文字当代码） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length))
}

interface Violation {
  file: string
  line: number
  text: string
}

/**
 * 一行里是否"只剩 var() 兜底"的颜色。
 * 做法：把每个 `var(--x, …)` 整段挖掉，再看剩下的部分还有没有颜色字面量。
 * 这样 `border: 1px solid var(--ui-line, rgba(0,0,0,.08))` 判为合法，
 * 而 `border: 1px solid rgba(0,0,0,.08)` 判为违规。
 */
function hasBareColor(line: string): boolean {
  let rest = ''
  let i = 0
  while (i < line.length) {
    const start = line.indexOf('var(', i)
    if (start === -1) {
      rest += line.slice(i)
      break
    }
    rest += line.slice(i, start)
    // 从 var( 起括号配对，整段跳过（兜底色就在里面）
    let depth = 0
    let j = start + 3
    for (; j < line.length; j++) {
      if (line[j] === '(') depth++
      else if (line[j] === ')') {
        depth--
        if (depth === 0) { j++; break }
      }
    }
    i = j
  }
  COLOR_LITERAL.lastIndex = 0
  return COLOR_LITERAL.test(rest)
}

function scan(): Violation[] {
  const out: Violation[] = []
  for (const dir of SCAN_DIRS) for (const full of walk(dir)) {
    const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/')
    if (EXEMPT_FILES.includes(rel)) continue
    const raw = readFileSync(full, 'utf-8')
    // 文档 §3.2 认可的"组件私有色板"：默认块给亮色值、`html.dark` 块给暗色值。
    // 这种写法里**自定义属性定义**本身就是两套值，属合规，不按"写死颜色"论处。
    const hasDarkBlock = /\.dark\b[^{]*\{|dark[^\n]*\{/.test(raw)
    // 只查样式与内联样式：.vue 的 <style> 段 + TS/JS 代码段都查（内联 :style 也在代码里）
    const code = stripComments(raw)
    const lines = code.split('\n')
    const rawLines = raw.split('\n')
    lines.forEach((line, idx) => {
      if (!hasBareColor(line)) return
      if (rawLines[idx]?.includes(ALLOW_MARK)) return
      // CSS 里 `//` 不是注释（会被当成声明的一部分而报错），所以样式段的豁免标记只能写在
      // 颜色那行的**正上方**（`/* 主题色白名单: 原因 */`）。这里连同上一行一起看。
      if (rawLines[idx - 1]?.includes(ALLOW_MARK)) return
      // 私有色板：`--xx: <颜色>` 定义行，且本文件有暗色块 → 合规
      if (hasDarkBlock && /^\s*--[\w-]+\s*:/.test(rawLines[idx] ?? '')) return
      out.push({
        file: rel,
        line: idx + 1,
        text: rawLines[idx]?.trim() ?? '',
      })
    })
  }
  return out
}

describe('插件里不写死颜色（改用主题 token）', () => {
  it('packages/plugins 下没有裸颜色字面量（var() 兜底与注释不算）', () => {
    const bad = scan()
    const report = bad
      .slice(0, 80)
      .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
      .join('\n')
    const more = bad.length > 80 ? `\n  …还有 ${bad.length - 80} 处` : ''
    expect(
      bad.length,
      `发现 ${bad.length} 处写死的颜色，请改用主题 token（见 docs/代码开发/主题与配色.md）：\n${report}${more}`,
    ).toBe(0)
  })

  /**
   * 豁免标记必须写在**合法注释**里。
   *
   * 为什么单开一条：CSS 里 `//` 不是注释 —— `background: x; // 主题色白名单: …` 会被 PostCSS
   * 当成"声明里冒出一个斜杠"，直接 `Missed semicolon` 报错，整个样式块编译失败（实测在浏览器里
   * 表现为白屏 + `Internal server error`）。而上面那条色净化断言只看"有没有颜色字面量"，
   * 标记本身写对了它就算过 —— 于是会出现"测试全绿但应用打不开"的假绿。
   * 这条专门盯样式段里的 `//` 标记。
   */
  it('样式段里的豁免标记必须用 /* */（CSS 不认 //，写了会让整个样式块编译失败）', () => {
    const bad: string[] = []
    for (const dir of SCAN_DIRS) for (const full of walk(dir)) {
      if (!full.endsWith('.vue')) continue
      const lines = readFileSync(full, 'utf-8').split('\n')
      let inStyle = false
      lines.forEach((line, i) => {
        if (/^\s*<style/.test(line)) inStyle = true
        if (/^\s*<\/style>/.test(line)) inStyle = false
        if (inStyle && line.includes(ALLOW_MARK) && line.includes('//')) {
          bad.push(`  ${path.relative(REPO_ROOT, full).replace(/\\/g, '/')}:${i + 1}  ${line.trim()}`)
        }
      })
    }
    expect(
      bad.length,
      `样式段里用了 // 注释写豁免标记（CSS 不支持，会导致该样式块编译失败）：\n${bad.join('\n')}`,
    ).toBe(0)
  })
})
