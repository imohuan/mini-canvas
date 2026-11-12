/**
 * 唯一静态注册表：DEV_PLUGIN_REGISTRY。
 *
 * 验收要求（docs/问题整理/18-…）：用 packages/plugins/*\/package.json 反向核对，
 * builtin 不遗漏、installable 不混进静态注册表。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { DEV_APP_PLUGINS, DEV_CANVAS_PLUGINS, DEV_PLUGIN_REGISTRY } from '../dev-plugins'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGINS_DIR = path.resolve(HERE, '../../../plugins')

interface Pkg {
  name?: string
  plume?: { pluginName?: string; builtin?: boolean; installable?: boolean }
}

function readPackages(): Array<{ dir: string; pkg: Pkg }> {
  const out: Array<{ dir: string; pkg: Pkg }> = []
  for (const dir of readdirSync(PLUGINS_DIR)) {
    if (dir.startsWith('_') || dir.startsWith('.')) continue
    const file = path.join(PLUGINS_DIR, dir, 'package.json')
    try {
      out.push({ dir, pkg: JSON.parse(readFileSync(file, 'utf-8')) as Pkg })
    } catch {
      /* 没有 package.json 的目录不是插件 */
    }
  }
  return out
}

describe('DEV_PLUGIN_REGISTRY（dev 静态清单）', () => {
  it('APP_PLUGINS / CANVAS_PLUGINS 都由注册表派生（顺序也一致）', () => {
    expect(DEV_APP_PLUGINS).toEqual(
      DEV_PLUGIN_REGISTRY.filter((e) => e.kind === 'app').map((e) => e.plugin),
    )
    expect(DEV_CANVAS_PLUGINS).toEqual(
      DEV_PLUGIN_REGISTRY.filter((e) => e.kind === 'canvas').map((e) => e.plugin),
    )
  })

  it('注册表无重名，且每条都有理由', () => {
    const names = DEV_PLUGIN_REGISTRY.map((e) => (e.plugin as { name?: string }).name)
    expect(names.every(Boolean)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    for (const entry of DEV_PLUGIN_REGISTRY) {
      expect(entry.reason.trim().length, JSON.stringify(entry.plugin)).toBeGreaterThan(0)
    }
  })

  it('builtin 插件全都登记；installable 插件不混进静态注册表', () => {
    const registered = new Set(
      DEV_PLUGIN_REGISTRY.map((e) => (e.plugin as { name?: string }).name),
    )
    for (const { dir, pkg } of readPackages()) {
      const mc = pkg.plume ?? {}
      const pluginName = mc.pluginName
      if (!pluginName) continue
      if (mc.builtin === true) {
        // 主题拆成了两个独立包：dir（包目录名）与 plume.pluginName 不同，
        // 两边都按 pluginName 核对（theme-components / theme-canvas 都在注册表里）。
        const themeSplit = dir === 'plugin-theme-components' || dir === 'plugin-theme-canvas'
        if (!themeSplit) {
          expect(registered.has(pluginName), dir + ' 声明 builtin 但没登记').toBe(true)
        }
      }
      if (mc.installable === true && mc.builtin !== true) {
        expect(registered.has(pluginName), dir + ' 是 installable，不该进静态注册表').toBe(false)
      }
    }
  })

  it('快捷键包登记的是设置页那一件（完整插件不在静态清单里）', () => {
    const names = DEV_PLUGIN_REGISTRY.map((e) => (e.plugin as { name?: string }).name)
    expect(names).toContain('shortcut-settings')
    expect(names).not.toContain('shortcut-manager')
  })

  it('默认主题的两件都在注册表里（theme-components 常驻、theme-canvas 画布级）', () => {
    const names = new Set(DEV_PLUGIN_REGISTRY.map((e) => (e.plugin as { name?: string }).name))
    expect(names.has('theme-components')).toBe(true)
    expect(names.has('theme-canvas')).toBe(true)
  })
})
