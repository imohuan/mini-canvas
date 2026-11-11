/**
 * 拆包边界守卫：两个主题包互不 import，只共享 @plume-canvas/theme-contract 的纯数据。
 *
 * 为什么钉成测试：拆包的目标是让项目页只启动通用组件、画布外观进画布才启动。
 * 一旦 components 为了某个组件去 import canvas（或反过来），两个包就重新焊在一起，
 * 拆包只剩下两个 package.json —— 而这种事在代码审查里很难盯住。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '../..')
const pluginsDir = resolve(pkgDir, '..')
const repo = resolve(pluginsDir, '../..')

interface Pkg {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function readPkg(dir: string): Pkg {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg
}

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full, out)
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

const SIBLING = '@plume-canvas/plugin-theme-canvas'

describe('主题拆包边界', () => {
  it('components 不声明、也不 import 画布包', () => {
    const pkg = readPkg(pkgDir)
    const declared = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    }
    expect(Object.keys(declared)).not.toContain(SIBLING)
    // 只查真正的 import / export 语句：注释里说明"另一半在哪个包"是正常的文档。
    for (const file of collectSources(join(pkgDir, 'src'))) {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!/^\s*(import|export)\b/.test(line)) continue
        expect(line, file).not.toContain(SIBLING)
      }
    }
  })

  it('主题契约包只有纯 TS：不 import .vue', () => {
    const contractDir = join(repo, 'packages/theme-contract/src')
    for (const file of collectSources(contractDir)) {
      expect(file.endsWith('.vue'), file).toBe(false)
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]+\.vue['"]/)
    }
  })

  it('旧聚合入口 theme-default 已删除（不留兼容壳）', () => {
    expect(() => statSync(join(pluginsDir, 'plugin-theme-default'))).toThrow()
  })
})

