const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
const BUILTIN = ['plugin-theme-components','plugin-theme-canvas','plugin-manager','plugin-agent','plugin-node-ui','plugin-bottom-bar','plugin-node-text','plugin-node-image','plugin-node-video','plugin-node-audio','plugin-node-3d-preview','plugin-node-rotate','plugin-image-grid-split','plugin-clipboard','plugin-context-menu','plugin-file-drop','plugin-group','plugin-multi-select','plugin-edge-cutting','plugin-style-library','plugin-shortcut-manager','plugin-mini-map','plugin-auto-layout','plugin-cloud-client']

function normalizeDist(pkgDir, dirName) {
  const dist = path.join(pkgDir, 'dist')
  if (!fs.existsSync(dist)) return { renames: [], hasServer: false }
  const files = fs.readdirSync(dist)
  const renames = []
  // 前端半：<dirName>.js 或 <pkg名>.js → web.js
  if (!files.includes('web.js')) {
    const cand = files.find((f) => f === dirName + '.js' || /^[a-z0-9-]+[.]js$/.test(f) && !f.endsWith('.map') && f !== 'server.js')
    if (cand) {
      fs.renameSync(path.join(dist, cand), path.join(dist, 'web.js'))
      renames.push([cand, 'web.js'])
    }
  }
  // 后台半：有 server.js 就认；否则找声明文件
  let hasServer = fs.readdirSync(dist).includes('server.js')
  return { renames, hasServer, dist }
}

const results = []
for (const d of BUILTIN) {
  const pkgDir = path.join(R, 'packages/plugins', d)
  const pkgPath = path.join(pkgDir, 'package.json')
  const backup = fs.readFileSync(pkgPath, 'utf8')
  const j = JSON.parse(backup)
  const p = j.version.split('.').map(Number)
  const nv = p[0] + '.' + p[1] + '.' + (p[2] + 1)
  j.version = nv
  delete j.private
  j.main = './dist/web.js'
  j.exports = { '.': './dist/web.js' }
  // 先改名产物
  const { renames, hasServer } = normalizeDist(pkgDir, d)
  j.plume = { ...(j.plume || {}), web: { ...((j.plume || {}).web || {}), entry: 'dist/web.js' } }
  if (hasServer) j.plume.server = { ...((j.plume || {}).server || {}), entry: 'dist/server.js' }
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
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: pkgDir, stdio: 'pipe', env: { ...process.env }, shell: true })
    results.push('OK   ' + d + '@' + nv + (hasServer ? ' [+server]' : ''))
  } catch (e) {
    const err = String(e.stderr || e.message)
    if (err.includes('cannot publish over') || err.includes('previously staged')) results.push('SKIP ' + d)
    else results.push('FAIL ' + d + ' :: ' + err.slice(-140).replace(/\n/g, ' '))
  } finally {
    fs.writeFileSync(pkgPath, backup)
    // 恢复 dist 文件名
    for (const [from, to] of renames) {
      try { fs.renameSync(path.join(pkgDir, 'dist', to), path.join(pkgDir, 'dist', from)) } catch (e) {}
    }
  }
}
console.log(results.join('\n'))
