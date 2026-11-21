const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas/packages/plugins'
const { execFileSync } = require('node:child_process')
let fixed = 0
for (const d of fs.readdirSync(R)) {
  if (!d.startsWith('plugin-')) continue
  const pkgDir = path.join(R, d)
  const pkgPath = path.join(pkgDir, 'package.json')
  const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  let out
  try { out = execFileSync('rg', ['-o', '@plume-canvas/[a-z-]+', path.join(pkgDir, 'src'), '-N', '--no-heading'], { encoding: 'utf8', shell: true }) } catch { continue }
  const used = [...new Set(out.split('\n').map((l) => l.split(':')[1]).filter(Boolean))]
  j.dependencies = j.dependencies || {}
  const missing = used.filter((dep) => !j.dependencies[dep] && dep !== j.name)
  if (!missing.length) continue
  for (const dep of missing) j.dependencies[dep] = 'workspace:*'
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n', 'utf8')
  fixed++
  console.log('fixed', d, 'missing:', missing.join(','))
}
console.log('total fixed:', fixed)
