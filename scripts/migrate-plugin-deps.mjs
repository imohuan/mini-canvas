/**
 * migrate-plugin-deps —— 一次性迁移:把插件包 dependencies 里的 @plume-canvas/* workspace:*
 * 移到 devDependencies(去重)。产物是 UMD,运行时依赖 external 到 window 全局,不需要 npm dependencies;
 * workspace:* 出现在 dependencies 会让 npm publish 产出装不上的包(2026-11-23 用户要求自动化闸)。
 * 用法:node scripts/migrate-plugin-deps.mjs [--dry]
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PLUGINS_ROOT = path.join(REPO, 'packages', 'plugins')
const dry = process.argv.includes('--dry')

const dirs = (await fs.readdir(PLUGINS_ROOT, { withFileTypes: true }))
  .filter(d => d.isDirectory())
  .map(d => d.name)

for (const name of dirs) {
  const pkgPath = path.join(PLUGINS_ROOT, name, 'package.json')
  let raw
  try { raw = await fs.readFile(pkgPath, 'utf8') } catch { continue }
  const pkg = JSON.parse(raw)
  const deps = pkg.dependencies ?? {}
  const moved = []
  for (const [dep, ver] of Object.entries(deps)) {
    if (dep.startsWith('@plume-canvas/') && String(ver).startsWith('workspace:')) {
      delete deps[dep]
      pkg.devDependencies ??= {}
      // devDeps 已有的 workspace:* 不覆盖
      if (!(dep in pkg.devDependencies)) pkg.devDependencies[dep] = ver
      moved.push(dep)
    }
  }
  if (moved.length === 0) continue
  if (Object.keys(deps).length === 0) delete pkg.dependencies
  if (!dry) await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log((dry ? '[dry] ' : '') + name + ': moved ' + moved.join(', '))
}
if (dry) console.log('(dry run, nothing written)')
