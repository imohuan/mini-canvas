/**
 * 插件依赖方向守卫（执行计划 T08）。
 *
 * 目标态：业务插件不再把默认主题当共享组件库。这条规则靠人工审查守不住（T06/T07 之前
 * 就是这么漂回去的），所以钉成测试：新增反向依赖会在这里直接红。
 *
 * 三条规则：
 * 1) 业务插件不得在 dependencies 里声明主题插件包（组件走主题可替换目录）；
 * 2) 业务插件源码不得出现指向主题插件包的运行时 import（测试代码除外）；
 * 3) canvas-base 不引入 Vue / VueFlow / 具体 UI 第三方库（它是纯类型 + 纯逻辑作者入口）。
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
// src/__tests__ → src → ui → packages
const packagesDir = resolve(here, '../../..')
const pluginsDir = join(packagesDir, 'plugins')

/**
 * 主题插件包（拆包后的两件）。
 *
 * 这条守卫的判据没变：业务插件不该把主题当组件库。拆分前是一个包，现在两个包各管一半，
 * 任何一个都不该被业务插件运行时依赖 —— 所以用集合而不是单个名字。
 */
const THEME_PACKAGES = new Set([
  '@mini-canvas/plugin-theme-components',
  '@mini-canvas/plugin-theme-canvas',
])

interface Pkg {
  name: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function readPkg(dir: string): Pkg {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Pkg
}

function pluginDirs(): string[] {
  return readdirSync(pluginsDir)
    .map((name) => join(pluginsDir, name))
    .filter((dir) => statSync(dir).isDirectory() && existsSync(join(dir, 'package.json')))
}

/** 递归收集生产源码（.ts/.vue），跳过测试目录与 node_modules */
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

describe('T08 · 业务插件不依赖默认主题当组件库', () => {
  it('没有任何业务插件在 dependencies 里声明主题插件包', () => {
    const offenders: string[] = []
    // 白名单：开发演示合集（demo-kit）。它是默认主题的"橱窗"——职责就是把主题组件
    // 真渲染出来给人看（含嵌真画布展示节点壳/连线/背景），所以它**必须**依赖主题包。
    // 这不是"业务插件当组件库用"的违规，而是展览者与展品的关系（2026-10-13 用户要求）。
    const GALLERY = '@mini-canvas/plugin-demo-kit'
    for (const dir of pluginDirs()) {
      const pkg = readPkg(dir)
      if (THEME_PACKAGES.has(pkg.name)) continue
      if (pkg.name === GALLERY) continue
      if ([...THEME_PACKAGES].some((name) => pkg.dependencies?.[name])) {
        offenders.push(pkg.name)
      }
    }
    expect(offenders, '这些插件把默认主题当运行时依赖：' + offenders.join(', ')).toEqual([])
  })

  it('业务插件生产源码不出现指向主题插件包的运行时 import', () => {
    const offenders: string[] = []
    // 同上白名单：展厅的运行时 import 是职责（见上一条用例的注释）
    const GALLERY_PKG = '@mini-canvas/plugin-demo-kit'
    for (const dir of pluginDirs()) {
      const pkg = readPkg(dir)
      if (THEME_PACKAGES.has(pkg.name)) continue
      if (pkg.name === GALLERY_PKG) continue
      for (const sub of ['src']) {
        const root = join(dir, sub)
        if (!existsSync(root)) continue
        for (const file of collectSources(root)) {
          for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
            // import type 不算运行时依赖（类型可擦除）；真正要拦的是值导入
            if (/^\s*import\b/.test(line) && [...THEME_PACKAGES].some((name) => line.includes(name))) {
              offenders.push(file.replace(packagesDir, '') + ' :: ' + line.trim())
            }
          }
        }
      }
    }
    expect(offenders, '生产代码直接 import 了默认主题：\n' + offenders.join('\n')).toEqual([])
  })
})

describe('T08 · canvas-base 保持纯作者入口', () => {
  it('不引入 Vue / VueFlow / 具体 UI 第三方库', () => {
    const baseDir = join(packagesDir, 'canvas-base')
    const pkg = readPkg(baseDir)
    const all = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.peerDependencies ?? {}),
    }
    expect(Object.keys(all)).not.toContain('vue')
    expect(Object.keys(all)).not.toContain('@vue-flow/core')
    // 具体 UI 库（颜色选择器等）属主题实现，不该进基础契约包
    for (const key of Object.keys(all)) {
      expect(key.startsWith('@ckpack/'), 'canvas-base 不该依赖 UI 库 ' + key).toBe(false)
    }
  })
})

describe('T08 · 组件库只由默认主题登记', () => {
  it('业务插件生产源码不直接 import @mini-canvas/ui-kit-shadcn', () => {
    const offenders: string[] = []
    // 展厅的 theme-lab 是组件库自己的独立工作台：它负责演示主题和组件库，
    // 不是业务插件。除它之外，业务插件只能从 ctx 的 ui 目录按名取件。
    const GALLERY_PKG = '@mini-canvas/plugin-demo-kit'
    for (const dir of pluginDirs()) {
      const pkg = readPkg(dir)
      if (THEME_PACKAGES.has(pkg.name)) continue
      if (pkg.name === GALLERY_PKG) continue
      const root = join(dir, 'src')
      if (!existsSync(root)) continue
      for (const file of collectSources(root)) {
        for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
          if (/^\s*import\b/.test(line) && line.includes('@mini-canvas/ui-kit-shadcn')) {
            offenders.push(file.replace(packagesDir, '') + ' :: ' + line.trim())
          }
        }
      }
    }
    expect(offenders, '这些插件绕过了 ui 目录：\n' + offenders.join('\n')).toEqual([])
  })

  it('外壳生产源码不直接 import @mini-canvas/ui-kit-shadcn', () => {
    const offenders: string[] = []
    // sharedGlobals.ts 是 UMD 插件的共享运行时出口：它必须把整个组件库挂到 window，
    // 这是基础设施，不是业务 UI 消费。样式入口 app.css 不扫（只看 .ts/.vue）。
    const ALLOW = new Set([join(here, '..', 'sharedGlobals.ts')])
    for (const file of collectSources(join(here, '..'))) {
      if (ALLOW.has(file)) continue
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (/^\s*import\b/.test(line) && line.includes('@mini-canvas/ui-kit-shadcn')) {
          offenders.push(file.replace(packagesDir, '') + ' :: ' + line.trim())
        }
      }
    }
    expect(offenders, '外壳绕过了 ui 目录：\n' + offenders.join('\n')).toEqual([])
  })
})
