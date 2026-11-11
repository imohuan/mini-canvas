/**
 * Agent 的后台半必须是**真插件**（2026-11-12 用户口径）。
 *
 * 背景：Agent 的后台代码一直住在 `plugin-agent/src/server/`，但宿主是直接 import 源码、
 * 编进 cloud-server 自己产物里的。结果发布包里 `plugin-agent/` 只有 `dist/web.js`，
 * 改 Agent 后端必须重发 cloud-server —— 违背「插件独立更新」。
 *
 * 本文件锁三件事：
 * 1. 产物叫 `dist/server.js` 且是自包含 ESM（宿主可能用文件路径 / data URL 两种方式加载）；
 * 2. 它导出了插件形状（name / inject / apply）—— 不是「库」，是能被加载器认同的插件；
 * 3. package.json 的 `plume.server.entry` 指向它（加载器只认配置，不猜文件名）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinModules } from 'node:module'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// __tests__ → src → 包根
const PKG = path.resolve(HERE, '../..')
const SERVER_JS = path.join(PKG, 'dist', 'server.js')

describe('plugin-agent 的后台半是插件', () => {
  it('★ 产物存在、是单文件（没有非 node: 的外部 import）', () => {
    expect(existsSync(SERVER_JS), '先跑 pnpm -C packages/plugins/plugin-agent build:server').toBe(true)
    const text = readFileSync(SERVER_JS, 'utf8')
    const specifiers = [...text.matchAll(/^import .*?from ['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
    // 依赖树里的 CJS 分支会写 `import from 'path'`（无 node: 前缀）—— 那也是内置模块。
    const builtins = new Set(builtinModules)
    const nonNode = specifiers.filter((s) => !s.startsWith('node:') && !builtins.has(s))
    // data: URL 加载时裸模块名解析不了；文件路径加载也要求依赖已内联
    expect(nonNode, '不该有外部依赖：' + nonNode.join(', ')).toEqual([])
  })

  it('★ 导出插件形状（name / inject / apply），不是只有库导出', async () => {
    const mod = (await import(/* @vite-ignore */ SERVER_JS)) as Record<string, unknown>
    expect(typeof mod.name).toBe('string')
    expect(String(mod.name)).toBe('agent')
    expect(Array.isArray(mod.inject)).toBe(true)
    expect(typeof mod.apply).toBe('function')
  })

  it('★ package.json 用 plume.server.entry 声明它（加载器按配置读，不猜文件名）', () => {
    const pkg = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8')) as {
      plume?: { server?: { entry?: string }; web?: { entry?: string } }
    }
    expect(pkg.plume?.server?.entry).toBe('dist/server.js')
    expect(pkg.plume?.web?.entry).toBe('dist/web.js')
  })
})
