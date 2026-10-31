/**
 * demo 插件的身份守卫。
 *
 * 演示件混进真实产品时不会有任何报错 —— 用户只会看到画布上多出几个“动作一 / 动作二”。
 * 这里把三件事钉死：
 * 1. 它是可安装件（installable），不是 builtin；
 * 2. package.json 的 pluginName、源码导出的 name、UMD 全局名三者对得上；
 * 3. 它能打出可安装的 UMD 产物（没有 dist 时跳过，避免在未构建环境里误报）。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { name } from '../index'

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as {
  miniCanvas?: { installable?: boolean; builtin?: boolean; pluginName?: string; title?: string }
  scripts?: Record<string, string>
}

describe('demo-ui-slots 清单身份', () => {
  it('是可安装示例，不是产品自带件', () => {
    expect(pkg.miniCanvas?.installable).toBe(true)
    expect(pkg.miniCanvas?.builtin).toBeUndefined()
  })

  it('清单名、运行时名一致，标题能认出是示例', () => {
    expect(pkg.miniCanvas?.pluginName).toBe('demo-ui-slots')
    expect(name).toBe('demo-ui-slots')
    expect(pkg.miniCanvas?.title).toContain('示例')
  })

  it('有 UMD 构建脚本；构建过就必须产出对应全局名', () => {
    expect(typeof pkg.scripts?.build).toBe('string')
    const out = path.join(PKG_ROOT, 'dist/plugin-ui-demo.js')
    if (!existsSync(out)) return
    expect(readFileSync(out, 'utf8')).toMatch(/\.MiniCanvasPluginDemoUiSlots\s*=\s*\{\}/)
  })
})
