const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const REPO = 'D:/Code/Git/mini-canvas'
const dirs = ["plugin-theme-canvas","plugin-manager","plugin-agent","plugin-node-ui","plugin-bottom-bar","plugin-node-text","plugin-node-image","plugin-node-video","plugin-node-audio","plugin-node-3d-preview","plugin-node-rotate","plugin-image-grid-split","plugin-context-menu","plugin-file-drop","plugin-group","plugin-multi-select","plugin-edge-cutting","plugin-style-library","plugin-shortcut-manager","plugin-mini-map","plugin-auto-layout","plugin-cloud-client"]
const npmArgs = (args) => ({ env: { ...process.env }, shell: true })
const results = []
for (const d of dirs) {
  const pkgDir = path.join(REPO, 'packages/plugins', d)
  const pkgPath = path.join(pkgDir, 'package.json')
  const backup = fs.readFileSync(pkgPath, 'utf8')
  const j = JSON.parse(backup)
  // 查 npm 上的最新版本
  let remote = 'none'
  try {
    remote = execFileSync('npm', ['view', '@plume-canvas/' + d, 'version', '--registry', 'https://registry.npmjs.org'], { encoding: 'utf8', shell: true }).trim()
  } catch { remote = 'none' }
  if (remote.startsWith('npm error')) remote = 'none'
  // bump：本地版本必须比 remote 新
  const local = j.version.split('.').map(Number)
  const rem = remote === 'none' ? [0,0,-1] : remote.split('.').map(Number)
  let nv
  if (local[0] > rem[0] || (local[0] === rem[0] && local[1] > rem[1]) || (local[0] === rem[0] && local[1] === rem[1] && local[2] > rem[2])) nv = j.version
  else nv = rem[0] + '.' + rem[1] + '.' + (rem[2] + 1)
  j.version = nv
  j.main = './dist/web.js'
  j.exports = { '.': './dist/web.js' }
  if (j.plume) j.plume.web = { ...((j.plume.web) || {}), entry: 'dist/web.js' }
  for (const k of ['dependencies', 'peerDependencies']) {
    if (!j[k]) continue
    for (const dep of Object.keys(j[k])) {
      if (dep.startsWith('@plume-canvas/')) delete j[k][dep]
      else if (String(j[k][dep]).startsWith('workspace:')) j[k][dep] = '*'
    }
    if (Object.keys(j[k]).length === 0) delete j[k]
  }
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n')
  try {
    const out = execFileSync('npm', ['publish', '--access', 'public'], { cwd: pkgDir, encoding: 'utf8', env: { ...process.env }, shell: true })
    results.push('OK   ' + d + '@' + nv + (remote !== 'none' ? ' (was ' + remote + ')' : ' (new)'))
  } catch (e) {
    const err = String(e.stderr || e.message)
    results.push('FAIL ' + d + ': ' + err.slice(err.length - 150).replace(/\n/g, ' '))
  } finally {
    fs.writeFileSync(pkgPath, backup)
  }
}
console.log(results.join('\n'))
