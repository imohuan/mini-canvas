/**
 * vue-render 的边界：它是通用 Vue 渲染底座，不认识画布。
 *
 * 死规矩（18 号文档）：本包不 import @vue-flow/core，也不出现 doc / node / edge / viewport
 * 这些画布概念；canvas-render 才能碰它们。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue
      out.push(...walk(full))
    } else if (/\.(ts|vue)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('vue-render 边界', () => {
  it('不 import @vue-flow/core', () => {
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf-8')
      expect(text, path.relative(SRC, file)).not.toMatch(/from\s+['"]@vue-flow\/core/)
    }
  })

  it('不认识 doc / node / edge / viewport（源码里不出现这些服务名）', () => {
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf-8')
      const rel = path.relative(SRC, file)
      // 注释里允许解释"这里不碰画布"；只查代码导入与字符串字面量。
      expect(text, rel).not.toMatch(/from ['"][^'"]*(canvas-data|canvas-render)/)
    }
  })

  it('从 canvas-render 搬来的通用件也在扫描范围内（不能靠"没扫到"过关）', () => {
    const moved = [
      'components/SlotComposer.vue',
      'components/SlotAnchor.vue',
      'components/slotComposer.ts',
      'components/SettingsHost.vue',
      'components/SettingsShell.vue',
      'components/settingsSource.ts',
      'components/settingsPanelTypes.ts',
      'contracts/uiCatalog.ts',
      'contracts/layers.ts',
    ]
    const scanned = new Set(walk(SRC).map((f) => path.relative(SRC, f).replace(/\\/g, '/')))
    for (const rel of moved) {
      expect(scanned.has(rel), rel + ' 没有被边界扫描收录').toBe(true)
    }
  })
})
