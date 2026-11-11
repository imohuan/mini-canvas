/**
 * 死规则：业务插件之间零引用。
 *
 * 判据（18 号文档）：packages/plugins/* 的源码里不能 import 另一个
 * @plume-canvas/plugin-*（运行时或类型都不行），package.json 的依赖也不允许。
 *
 * 豁免：测试文件、plugin-demo-kit 示例、ui-shell 入口自带件（本文件只扫 plugins/*）。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGINS_DIR = path.resolve(HERE, '../../../plugins')

const EXEMPT_DIRS = new Set(['plugin-demo-kit'])
/** 过渡例外表为空：已知的 theme-default → shortcut-manager 引用已改为按名取件。 */
const EXEMPT_EDGES: Array<[from: string, to: string]> = []

function isExemptEdge(fromDir: string, spec: string): boolean {
  return EXEMPT_EDGES.some(([from, to]) => from === fromDir && spec.startsWith(to))
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(ts|vue)$/.test(name) && !name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

describe('业务插件零引用', () => {
  it('源码不 import 另一个 @plume-canvas/plugin-*', () => {
    for (const dir of readdirSync(PLUGINS_DIR)) {
      if (EXEMPT_DIRS.has(dir)) continue
      const root = path.join(PLUGINS_DIR, dir)
      if (!statSync(root).isDirectory()) continue
      const self = '@plume-canvas/' + dir
      for (const file of walk(root)) {
        const text = readFileSync(file, 'utf-8')
        // 只看真实 import 行（行首 import / export ... from），注释里的示例不算。
        const imports = [
          ...text.matchAll(/^\s*(?:import|export)[^\n]*?from\s+['"](@plume-canvas\/plugin-[^'"]+)['"]/gm),
        ]
        for (const m of imports) {
          if (isExemptEdge(dir, m[1])) continue
          expect(m[1], path.relative(PLUGINS_DIR, file)).toBe(self)
        }
      }
    }
  })

  it('package.json 的 dependencies 不含另一个业务插件', () => {
    for (const dir of readdirSync(PLUGINS_DIR)) {
      if (EXEMPT_DIRS.has(dir)) continue
      const pkgFile = path.join(PLUGINS_DIR, dir, 'package.json')
      let pkg: { dependencies?: Record<string, string>; name?: string }
      try {
        pkg = JSON.parse(readFileSync(pkgFile, 'utf-8')) as typeof pkg
      } catch {
        continue
      }
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        if (!dep.startsWith('@plume-canvas/plugin-')) continue
        expect(dep, dir + ' 的 dependencies 引用了另一个业务插件').toBe(pkg.name)
      }
    }
  })
})
