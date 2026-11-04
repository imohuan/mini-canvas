/**
 * 主题拆包边界守卫（画布半边）。
 *
 * canvas 包只放画布外观；通用组件在 plugin-theme-components，两边互不 import。
 * 共享的默认值 / Config 分片 / 边几何都在 @mini-canvas/theme-contract。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '../..')

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

const SIBLING = '@mini-canvas/plugin-theme-components'

describe('主题拆包边界（画布半边）', () => {
  it('canvas 不声明、也不 import 通用组件包', () => {
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

  it('插件只注册画布槽与画布件，不碰设置面板', () => {
    const index = readFileSync(join(pkgDir, 'src/index.ts'), 'utf8')
    expect(index).toContain('theme-canvas/node-top-slot')
    expect(index).not.toContain('settingsPanel')
    expect(index).not.toContain('settingsField')
  })
})

