/**
 * 插件前端产物不得残留 `process.env.NODE_ENV`。
 *
 * 真实现象（2026-11-12）：点底栏「生成历史」，弹框一渲染就
 * `ReferenceError: process is not defined`，整个浮层黑屏。
 * 根因是两个主题插件把 `reka-ui` / `@vuelor/picker` 内联进了产物，
 * 这些第三方库自带 `process.env.NODE_ENV` 判断；vite 的 lib 模式只替换自己
 * 生成的那部分，内联依赖里的一律原样留着。浏览器没有 `process`，一执行就炸。
 *
 * 修法是把 `define` 提到 config 顶层（见 packages/plugins/vite-plugin-lib.ts 的
 * PLUGIN_DEFINE）。这条守卫不看配置、只扫**真产物**，配置写对了但没生效也能抓到。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')
const PLUGINS_DIR = path.join(REPO, 'packages', 'plugins')

/**
 * 仓库里所有插件的**前端**产物（没构建过的跳过）。
 *
 * server.js 跑在 Node 里，process 本来就有，不该在这一条里判红。
 */
function builtPluginBundles(): string[] {
  const out: string[] = []
  for (const name of readdirSync(PLUGINS_DIR)) {
    const dist = path.join(PLUGINS_DIR, name, 'dist')
    if (!existsSync(dist) || !statSync(dist).isDirectory()) continue
    for (const file of readdirSync(dist)) {
      if (!file.endsWith('.js')) continue
      if (/^server(\.|-)/.test(file)) continue
      out.push(path.join(dist, file))
    }
  }
  return out
}

describe('插件产物不依赖浏览器里不存在的 process', () => {
  it('PLUGIN_DEFINE 把 process.env.NODE_ENV 固定成 production', () => {
    const src = readFileSync(path.join(PLUGINS_DIR, 'vite-plugin-lib.ts'), 'utf8')
    expect(src).toMatch(/process\.env\.NODE_ENV/)
    expect(src).toMatch(/PLUGIN_DEFINE/)
  })

  it('★ 已构建的前端产物里没有 process.env.NODE_ENV', () => {
    const bundles = builtPluginBundles()
    expect(bundles.length, '一个插件产物都没有，先跑 pnpm -C packages/cloud-server build:assets').toBeGreaterThan(0)
    const offenders = bundles
      .filter((file) => readFileSync(file, 'utf8').includes('process.env.NODE_ENV'))
      .map((file) => path.relative(REPO, file))
    expect(offenders, '这些产物在浏览器里会 ReferenceError（把 define 写进 vite config 顶层）：\n' + offenders.join('\n')).toEqual([])
  })
})
