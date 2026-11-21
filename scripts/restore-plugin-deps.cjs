const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
// npm 上的真实版本（用于本地 version 字段对齐）
const npmVersions = {"plugin-theme-components":"0.1.3","plugin-theme-canvas":"0.1.3","plugin-manager":"0.1.3","plugin-agent":"0.1.4","plugin-node-ui":"0.1.4","plugin-bottom-bar":"0.1.3","plugin-node-text":"0.1.4","plugin-node-image":"0.1.4","plugin-node-video":"0.1.4","plugin-node-audio":"0.1.4","plugin-node-3d-preview":"0.1.4","plugin-node-rotate":"0.1.4","plugin-image-grid-split":"0.1.4","plugin-clipboard":"0.1.5","plugin-context-menu":"0.1.3","plugin-file-drop":"0.1.3","plugin-group":"0.1.4","plugin-multi-select":"0.1.3","plugin-edge-cutting":"0.1.4","plugin-style-library":"0.1.3","plugin-shortcut-manager":"0.1.4","plugin-mini-map":"0.1.4","plugin-auto-layout":"0.1.3","plugin-cloud-client":"0.1.4"}
let fixed = 0
for (const [dir, ver] of Object.entries(npmVersions)) {
  const p = path.join(R, 'packages/plugins', dir, 'package.json')
  const cur = JSON.parse(fs.readFileSync(p, 'utf8'))
  // 从干净 commit 拿 dependencies
  let oldDeps
  try {
    const old = JSON.parse(execFileSync('git', ['show', 'd76894e9:packages/plugins/' + dir + '/package.json'], { cwd: R, encoding: 'utf8' }))
    oldDeps = old.dependencies
  } catch { oldDeps = null }
  const needsFix = oldDeps && JSON.stringify(cur.dependencies || {}) !== JSON.stringify(oldDeps)
  if (!needsFix) continue
  cur.version = ver
  cur.dependencies = oldDeps
  // 恢复 dev 形态（main/exports 指 src）
  cur.main = './src/index.ts'
  cur.exports = { '.': { types: './src/index.ts', default: './src/index.ts' }, './*': './src/*' }
  fs.writeFileSync(p, JSON.stringify(cur, null, 2) + '\n')
  fixed++
  console.log('fixed', dir, '->', ver)
}
console.log('total fixed:', fixed)
