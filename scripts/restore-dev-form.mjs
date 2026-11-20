// 一次性修复：把 prep-publish 误写的 main/exports 恢复成源码形态
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = await readFile(path.join(REPO_ROOT, 'apps/server/src/plugins/builtinPlugins.ts'), 'utf8')
const dirs = [...src.matchAll(/\{\s*dir:\s*['"]([^'"]+)['"]/g)].map((m) => m[1])
for (const dir of dirs) {
  const p = path.join(REPO_ROOT, 'packages/plugins', dir, 'package.json')
  const pkg = JSON.parse(await readFile(p, 'utf8'))
  pkg.main = './src/index.ts'
  pkg.exports = { '.': { types: './src/index.ts', default: './src/index.ts' }, './*': './src/*' }
  await writeFile(p, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
}
console.log('restored ' + dirs.length + ' package.json to source form')
