const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
const CORE = [
  { rel: 'packages/engine/kernel', v: '0.1.1' },
  { rel: 'packages/engine/canvas-data', v: '0.1.1' },
  { rel: 'packages/engine/vue-render', v: '0.1.1' },
  { rel: 'packages/libs/plugin-sdk', v: '0.1.1' },
  { rel: 'packages/engine/canvas-render', v: '0.1.1' },
]
const results = []
for (const job of CORE) {
  const pkgDir = path.join(R, job.rel)
  const pkgPath = path.join(pkgDir, 'package.json')
  const backup = fs.readFileSync(pkgPath, 'utf8')
  const j = JSON.parse(backup)
  j.version = job.v
  delete j.private
  for (const k of ['dependencies', 'peerDependencies']) {
    if (!j[k]) continue
    for (const d of Object.keys(j[k])) {
      if (String(j[k][d]).startsWith('workspace:')) j[k][d] = '0.1.0'
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n')
  try {
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: pkgDir, stdio: 'pipe', env: { ...process.env }, shell: true })
    results.push('OK   ' + j.name + '@' + job.v)
  } catch (e) {
    results.push('FAIL ' + j.name + ' :: ' + String(e.stderr || e.message).slice(-160).replace(/\n/g, ' '))
  } finally {
    fs.writeFileSync(pkgPath, backup)
  }
}
console.log(results.join('\n'))
