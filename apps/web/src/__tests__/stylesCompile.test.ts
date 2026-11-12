/**
 * 全仓 `.vue` 的样式段必须能被 PostCSS 解析 —— 编译期守门。
 *
 * 为什么需要：色净化守卫只看"有没有颜色字面量"，它**看不见语法错误**。
 * 实测踩过一次假绿：豁免标记被写成 `background: x; // 主题色白名单: …`，
 * CSS 里 `//` 不是注释 → PostCSS `Missed semicolon` → 整个 `<style>` 块编译失败。
 * 单测全绿，但 `pnpm dev` 起不来、页面白屏（浏览器里的报错是 `Internal server error`）。
 * 这条把"样式段能不能编译"变成测试，堵住那种"测试绿、应用打不开"的缺口。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
// 用 Vue 自带的 SFC 样式编译器：它就是 vite 处理 .vue 时用的那一套（postcss 直接 import 不到）。
import { compileStyle } from 'vue/compiler-sfc'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const SCAN_DIRS = ['packages/plugins', 'packages/canvas-render', 'packages/ui'].map((p) =>
  path.join(REPO_ROOT, ...p.split('/')),
)

function walkVue(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walkVue(full, out)
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** 抽出所有 `<style>` 段（含 scoped / lang="css"；不含 lang="scss" 等需预处理的） */
function styleBlocks(src: string): string[] {
  const out: string[] = []
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const attrs = m[1] ?? ''
    if (/lang\s*=\s*["'](scss|sass|less|stylus)["']/.test(attrs)) continue
    out.push(m[2] ?? '')
  }
  return out
}

describe('全仓 .vue 样式段可编译（堵"测试绿但应用打不开"）', () => {
  it('每个 <style> 段都能被 PostCSS 解析（`//` 注释、少分号等在 CSS 里都是语法错误）', () => {
    const failures: string[] = []
    let checked = 0
    for (const dir of SCAN_DIRS) for (const full of walkVue(dir)) {
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/')
      for (const css of styleBlocks(readFileSync(full, 'utf-8'))) {
        if (!css.trim()) continue
        checked++
        try {
          compileStyle({ source: css, filename: rel, id: 'data-v-test' })
        } catch (err) {
          failures.push(`  ${rel}\n    ${String((err as Error).message).split('\n')[0]}`)
        }
      }
    }
    // 防止扫描范围写错导致"零个样式块通过"这种空断言（实测当前约 58 个，取个宽松下限）
    expect(checked, '没有扫到任何样式段，扫描路径可能写错了').toBeGreaterThan(40)
    expect(failures.length, `以下样式段解析失败：\n${failures.join('\n')}`).toBe(0)
  })
})
