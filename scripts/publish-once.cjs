const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const REPO = 'D:/Code/Git/mini-canvas'
const dirs = ["plugin-theme-components","plugin-theme-canvas","plugin-manager","plugin-agent","plugin-node-ui","plugin-bottom-bar","plugin-node-text","plugin-node-image","plugin-node-video","plugin-node-audio","plugin-node-3d-preview","plugin-node-rotate","plugin-image-grid-split","plugin-context-menu","plugin-file-drop","plugin-group","plugin-multi-select","plugin-edge-cutting","plugin-style-library","plugin-shortcut-manager","plugin-mini-map","plugin-auto-layout","plugin-cloud-client"]
let okCount = 0, skipCount = 0, failed = null
for (const d of dirs) {
  const pkgDir = path.join(REPO, 'packages/plugins', d)
  const pkgPath = path.join(pkgDir, 'package.json')
  const backup = fs.readFileSync(pkgPath, 'utf8')
  const j = JSON.parse(backup)
  j.main = './dist/web.js'
  j.exports = { '.': './dist/web.js' }
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n')
  try {
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: pkgDir, stdio: 'pipe', env: { ...process.env }, shell: true })
    console.log('OK   ' + d)
    okCount++
  } catch (e) {
    const err = String(e.stderr || e.message)
    if (err.includes('cannot publish over') || err.includes('EPUBLISHCONFLICT')) {
      console.log('SKIP ' + d + ' (already published)')
      skipCount++
    } else {
      console.error('FAIL ' + d + ': ' + err.slice(0, 250))
      failed = d
    }
  } finally {
    fs.writeFileSync(pkgPath, backup)
  }
  if (failed) break
}
console.log('done: ok=' + okCount + ' skip=' + skipCount + ' failed=' + (failed || 'none'))
process.exit(failed ? 1 : 0)
