/**
 * 外部 UMD 插件全局覆盖守卫。
 *
 * 背景：经「插件管理」安装的插件是 UMD 产物，靠 window 上的全局取依赖（Vue / MiniCanvasCore / …）。
 * 这些全局由 `src/sharedGlobals.ts` 在应用启动前暴露。**唯一事实源**是
 * `packages/plugins/vite-plugin-lib.ts` 的 HOST_GLOBALS（各插件打包都从它取 external/globals）。
 *
 * 这条把两件事钉成测试：
 * 1. ui 的 sharedGlobals 覆盖了 HOST_GLOBALS 里**所有**全局名（少一个，对应插件会在浏览器里直接炸）；
 * 2. 每个 installable 插件产物的 `requiresGlobals` ⊆ ui 暴露的全局 —— 用真产物核，避免"配置表对了、
 *    产物却引了别的"这种更隐蔽的漂移。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exposeSharedGlobals, SHARED_GLOBAL_NAMES } from '../sharedGlobals'
import { HOST_GLOBALS } from '../../../../packages/plugins/vite-plugin-lib'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const PLUGINS_DIR = path.join(REPO_ROOT, 'packages', 'plugins')

/** 声明了 miniCanvas.installable=true 的插件目录（= 交给插件管理安装的那些） */
function installablePluginDirs(): string[] {
  return readdirSync(PLUGINS_DIR)
    .map((name) => path.join(PLUGINS_DIR, name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')))
    .filter((dir) => {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        miniCanvas?: { installable?: boolean }
      }
      return pkg.miniCanvas?.installable === true
    })
}

/** 从插件产物里读出它运行时需要的 window 全局（与 cloud-server 的 parseRequiresGlobals 同口径） */
function requiresGlobalsOf(bundle: string): string[] {
  const text = readFileSync(bundle, 'utf8')
  const anchor = text.match(/\.MiniCanvasPlugin[A-Za-z0-9_]+\s*=\s*\{\}/)
  if (!anchor || anchor.index === undefined) return []
  const head = text.slice(anchor.index, anchor.index + 800)
  return Object.values(HOST_GLOBALS).filter((g) => new RegExp('[,(]\\s*[a-zA-Z_$][\\w$]*\\.' + g + '\\b').test(head))
}

describe('外部插件全局覆盖（插件管理装的那些）', () => {
  it('exposeSharedGlobals 真的把声明的名字挂上（幂等、不覆盖已有的）', () => {
    const target: Record<string, unknown> = {}
    exposeSharedGlobals(target)
    for (const name of SHARED_GLOBAL_NAMES) {
      expect(target[name], name + ' 未暴露').toBeTruthy()
    }
    // 不覆盖已有：先放一个哨兵，不该被换掉
    const holder: Record<string, unknown> = { Vue: 'sentinel' }
    exposeSharedGlobals(holder)
    expect(holder.Vue).toBe('sentinel')
  })

  it('每个 installable 插件声明的全局都被 ui 覆盖（否则加载必炸且测不出来）', () => {
    const dirs = installablePluginDirs()
    expect(dirs.length, '没有找到任何 miniCanvas.installable 插件，判据可能写错了').toBeGreaterThan(0)
    const exposed = new Set<string>(SHARED_GLOBAL_NAMES)
    // ui 覆盖了打包表里的每一个全局名
    for (const g of Object.values(HOST_GLOBALS)) {
      expect(exposed.has(g), `打包表里的全局 ${g} 没被 ui 暴露（改 sharedGlobals.ts）`).toBe(true)
    }
    // 真产物核一轮（没构建的跳过；构建过的才算硬证据）
    for (const dir of dirs) {
      const dist = path.join(dir, 'dist')
      if (!existsSync(dist)) continue
      const js = readdirSync(dist).find((f) => f.endsWith('.js') && !f.endsWith('.map'))
      if (!js) continue
      for (const g of requiresGlobalsOf(path.join(dist, js))) {
        expect(exposed.has(g), path.basename(dir) + ' 的产物依赖全局 ' + g + '，但 ui 没暴露它').toBe(true)
      }
    }
  })
})
