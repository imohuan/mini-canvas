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
const PLUGINS_DIR = path.resolve(HERE, '../../../../packages/plugins')

const EXEMPT_DIRS = new Set<string>()
/**
 * 名字带 plugin- 但不是业务插件的库：plugin-sdk 是作者入口（只有类型与纯函数），
 * 谁都允许依赖它。判据仍是「插件之间不能互相 import」。
 */
const LIB_PACKAGES = new Set(['@plume-canvas/plugin-sdk'])
/** 例外表保持为空：插件之间零引用是死规则，不靠白名单放行。 */
const EXEMPT_EDGES: Array<[from: string, to: string]> = []

function isExemptEdge(fromDir: string, spec: string): boolean {
  if (LIB_PACKAGES.has(spec)) return false
  return EXEMPT_EDGES.some(([from, to]) => from === fromDir && spec.startsWith(to))
}

function isLibrary(spec: string): boolean {
  return LIB_PACKAGES.has(spec)
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

/** 递归收集全部源码（含 __tests__），用于"测试也不许跨插件"这条守卫 */
function walkAll(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      out.push(...walkAll(full))
    } else if (/\.(ts|vue)$/.test(name)) {
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
          if (isLibrary(m[1])) continue
          if (isExemptEdge(dir, m[1])) continue
          expect(m[1], path.relative(PLUGINS_DIR, file)).toBe(self)
        }
      }
    }
  })

  it('package.json 的依赖（含 devDependencies）不含另一个业务插件', () => {
    for (const dir of readdirSync(PLUGINS_DIR)) {
      if (EXEMPT_DIRS.has(dir)) continue
      const pkgFile = path.join(PLUGINS_DIR, dir, 'package.json')
      let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; name?: string }
      try {
        pkg = JSON.parse(readFileSync(pkgFile, 'utf-8')) as typeof pkg
      } catch {
        continue
      }
      // 开发依赖也要拦：测试里 import 别的插件同样会让 workspace 建出循环依赖。
      for (const field of ['dependencies', 'devDependencies'] as const) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
          if (!dep.startsWith('@plume-canvas/plugin-')) continue
          if (isLibrary(dep)) continue
          if (isExemptEdge(dir, dep)) continue
          expect(dep, dir + ' 的 ' + field + ' 引用了另一个业务插件').toBe(pkg.name)
        }
      }
    }
  })

  /**
   * 测试代码也要拦。
   *
   * 理由不是洁癖：测试 import 另一个插件同样会让 pnpm 在 workspace 里建出循环依赖
   * （实测 canvas-render ⇄ plugin-multi-select），而且那种循环只在安装时才出声。
   * 需要「真实主题组件长什么样」的断言去主题包自己的测试里验；宿主侧在
   * 本插件自己的 __tests__ 目录放最小替身，锁「取的是正确名字、传的是正确形态」。
   */
  it('测试代码也不 import 另一个 @plume-canvas/plugin-*', () => {
    const offenders: string[] = []
    for (const dir of readdirSync(PLUGINS_DIR)) {
      if (EXEMPT_DIRS.has(dir)) continue
      const root = path.join(PLUGINS_DIR, dir)
      if (!statSync(root).isDirectory()) continue
      const self = '@plume-canvas/' + dir
      for (const file of walkAll(root)) {
        const text = readFileSync(file, 'utf-8')
        const imports = [
          ...text.matchAll(/^\s*(?:import|export)[^\n]*?from\s+['"](@plume-canvas\/plugin-[^'"]+)['"]/gm),
        ]
        for (const m of imports) {
          if (isLibrary(m[1])) continue
          if (isExemptEdge(dir, m[1])) continue
          if (m[1] === self) continue
          offenders.push(path.relative(PLUGINS_DIR, file) + ' :: ' + m[1])
        }
      }
    }
    expect(offenders, '测试里跨插件 import（会让 workspace 成环）：\n' + offenders.join('\n')).toEqual([])
  })
})
