/**
 * 底座不反向依赖插件：引擎四层（kernel / canvas-data / vue-render / canvas-render）
 * 只能往下依赖，不能 import 任何一个 @plume-canvas/plugin-*。
 *
 * 为什么单独钉一条：插件零引用守卫只扫 packages/plugins，引擎里出现反向 import 时
 * 没有任何测试会红 —— 而它会把"插件可热装可卸载"这条根基直接焊死，等发现时已经晚了。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const ENGINE_DIR = path.join(REPO_ROOT, 'packages/engine')

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

describe('引擎层不反向依赖插件', () => {
  it('源码不 import @plume-canvas/plugin-*', () => {
    for (const pkg of readdirSync(ENGINE_DIR)) {
      const root = path.join(ENGINE_DIR, pkg, 'src')
      try {
        if (!statSync(root).isDirectory()) continue
      } catch {
        continue
      }
      for (const file of walk(root)) {
        const text = readFileSync(file, 'utf-8')
        const imports = [
          ...text.matchAll(/^\s*(?:import|export)[^\n]*?from\s+['"](@plume-canvas\/plugin-[^'"]+)['"]/gm),
        ]
        for (const m of imports) {
          expect(m[1], path.relative(REPO_ROOT, file)).toBeUndefined()
        }
      }
    }
  })

  it('package.json 的依赖里没有插件包', () => {
    for (const pkg of readdirSync(ENGINE_DIR)) {
      const file = path.join(ENGINE_DIR, pkg, 'package.json')
      let json: {
        name?: string
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      try {
        json = JSON.parse(readFileSync(file, 'utf8')) as typeof json
      } catch {
        continue
      }
      // 开发依赖也算：它照样会让 pnpm 建出 workspace 循环，还会让引擎测试反向依赖插件。
      const deps = {
        ...(json.dependencies ?? {}),
        ...(json.peerDependencies ?? {}),
        ...(json.devDependencies ?? {}),
      }
      for (const dep of Object.keys(deps)) {
        expect(dep.startsWith('@plume-canvas/plugin-'), json.name + ' 依赖了插件 ' + dep).toBe(false)
      }
    }
  })
})

