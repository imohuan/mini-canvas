/**
 * 步骤 7 守卫：插件包之间不许成环（设计文档 docs/design/core-layers-and-registry.md §九 步骤 7）。
 *
 * 背景：历史上 plugin-theme-default 与 plugin-node-text / plugin-node-image 互指 ——
 * theme-default 的 devDependencies 里有 node-text / node-image，而它们又 dependencies 依赖
 * theme-default（复用它的 MovingHandle / Select 等）。双向即成环：pnpm 装包时报警，模块初始化
 * 顺序不可控。断环的关键一半是**去掉 theme-default 对节点插件的依赖**（环 = 双向路径，断一头即无环）。
 *
 * 为什么不用 madge：madge 解析 .vue 会失败（本仓插件大量 .vue），查不出插件包之间的真实边。
 * package.json 的 dependencies/devDependencies/peerDependencies 才是 pnpm 认定"包依赖"的依据，
 * 也正是环的判据（theme-default → 节点插件 那条腿当时只存在于 devDeps + 一条 import type）。
 *
 * 断言三件事：
 * 1. theme-default 不声明任何 @mini-canvas/plugin-* 依赖；
 * 2. theme-default 的源码（含 demo-web 预览页）里没有指向其它插件包的 import 边
 *    （防"只删 package.json 却留着 import"——这条腿历史上正是落在 demo-web/App.vue 上）；
 * 3. packages/plugins/* 的 plugin-* 依赖图无环。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
// src/__tests__ → src → plugin-theme-default → plugins
const pluginsDir = resolve(here, '../../..')
const themeDefaultDir = resolve(here, '../..')

interface Pkg {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function readPkg(dir: string): Pkg {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg
}

function declaredPluginDeps(pkg: Pkg): string[] {
  const out: string[] = []
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    for (const key of Object.keys(pkg[section] ?? {})) {
      if (key.startsWith('@mini-canvas/plugin-')) out.push(key)
    }
  }
  return out
}

/** 递归收集源码文件（.ts/.vue），跳过测试目录。 */
function collectSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectSources(full))
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('步骤 7 · 插件包无环', () => {
  it('theme-default 不声明任何 @mini-canvas/plugin-* 依赖（断掉"皮肤依赖业务节点"这条腿）', () => {
    const pkg = readPkg(themeDefaultDir)
    expect(pkg.name).toBe('@mini-canvas/plugin-theme-default')
    expect(declaredPluginDeps(pkg)).toEqual([])
  })

  it('theme-default 源码（含 demo-web 预览页）里没有指向其它插件包的 import 边', () => {
    const offenders: string[] = []
    // src 与 demo-web 都扫：devDependencies 那条腿当年就落在 demo-web/App.vue 的 import 上，
    // 只查 src 会漏掉最容易复发的那处。
    for (const dir of [join(themeDefaultDir, 'src'), join(themeDefaultDir, 'demo-web')]) {
      if (!existsSync(dir)) continue
      for (const file of collectSources(dir)) {
        const text = readFileSync(file, 'utf8')
        for (const line of text.split(/\r?\n/)) {
          // 只认真正的 import/export from 语句（注释里提到插件名不算）
          if (/^\s*(import|export)\b/.test(line) && line.includes('@mini-canvas/plugin-')) {
            offenders.push(file.replace(themeDefaultDir, '') + ' :: ' + line.trim())
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('packages/plugins/* 之间的 plugin-* 依赖图无环（package.json 的 deps/devDeps/peerDeps）', () => {
    const graph = new Map<string, string[]>()
    for (const dirName of readdirSync(pluginsDir)) {
      const dir = join(pluginsDir, dirName)
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(join(dir, 'package.json'))) continue
      const pkg = readPkg(dir)
      graph.set(pkg.name, declaredPluginDeps(pkg))
    }

    const state = new Map<string, 0 | 1 | 2>()
    const stack: string[] = []
    const cycles: string[] = []
    const visit = (node: string): void => {
      state.set(node, 1)
      stack.push(node)
      for (const next of graph.get(node) ?? []) {
        if (!graph.has(next)) continue // 图外的依赖不算插件间边
        const s = state.get(next) ?? 0
        if (s === 1) cycles.push(stack.slice(stack.indexOf(next)).concat(next).join(' -> '))
        else if (s === 0) visit(next)
      }
      stack.pop()
      state.set(node, 2)
    }
    for (const node of graph.keys()) if ((state.get(node) ?? 0) === 0) visit(node)

    expect(cycles, '插件包之间出现循环依赖：\n' + cycles.join('\n')).toEqual([])
  })
})
