const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
const order = ['packages/engine/kernel', 'packages/engine/canvas-data', 'packages/engine/vue-render', 'packages/libs/plugin-sdk', 'packages/engine/canvas-render']
const results = []
for (const rel of order) {
  const pkgDir = path.join(R, rel)
  const pkgPath = path.join(pkgDir, 'package.json')
  const backup = fs.readFileSync(pkgPath, 'utf8')
  const j = JSON.parse(backup)
  j.version = '0.1.0'
  delete j.private
  j.publishConfig = j.publishConfig || {}
  j.publishConfig.access = 'public'
  // workspace:* 转实际版本（这些包互相依赖 0.1.0）
  for (const k of ['dependencies', 'peerDependencies']) {
    if (!j[k]) continue
    for (const d of Object.keys(j[k])) if (String(j[k][d]).startsWith('workspace:')) j[k][d] = '0.1.0'
  }
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n')
  try {
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: pkgDir, encoding: 'utf8', env: { ...process.env }, shell: true })
    results.push('OK   ' + j.name + '@0.1.0')
  } catch (e) {
    results.push('FAIL ' + j.name + ': ' + String(e.stderr || e.message).slice(0, 200))
  } finally {
    fs.writeFileSync(pkgPath, backup)
  }
}
console.log(results.join('\n'))
