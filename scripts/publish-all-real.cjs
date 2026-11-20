// publish-all-real - 统一发布所有包（README 上 npm）
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'

// 顺序：core 包先（被依赖），再插件
const CORE = [
  { rel: 'packages/engine/kernel', keepDeps: true },
  { rel: 'packages/engine/canvas-data', keepDeps: true },
  { rel: 'packages/engine/vue-render', keepDeps: true },
  { rel: 'packages/libs/plugin-sdk', keepDeps: true },
  { rel: 'packages/engine/canvas-render', keepDeps: true },
  { rel: 'apps/web', ui: true },
  { rel: 'apps/server' },
]
const PLUGIN_DIRS = fs.readdirSync(path.join(R, 'packages/plugins')).filter((d) => d.startsWith('plugin-')).sort()
const BUILTIN = ['plugin-theme-components','plugin-theme-canvas','plugin-manager','plugin-agent','plugin-node-ui','plugin-bottom-bar','plugin-node-text','plugin-node-image','plugin-node-video','plugin-node-audio','plugin-node-3d-preview','plugin-node-rotate','plugin-image-grid-split','plugin-clipboard','plugin-context-menu','plugin-file-drop','plugin-group','plugin-multi-select','plugin-edge-cutting','plugin-style-library','plugin-shortcut-manager','plugin-mini-map','plugin-auto-layout','plugin-cloud-client']
const PLUGINS = BUILTIN.map((d) => ({ rel: 'packages/plugins/' + d }))

const results = []
for (const job of [...CORE, ...PLUGINS]) {
  const pkgDir = path.join(R, job.rel)
  const pkgPath = path.join(pkgDir, 'package.json')
  const backup = fs.readFileSync(pkgPath, 'utf8')
  const j = JSON.parse(backup)
  const name = j.name
  // bump patch
  const p = j.version.split('.').map(Number)
  const nv = p[0] + '.' + p[1] + '.' + (p[2] + 1)
  j.version = nv
  delete j.private
  // 发布形态
  if (job.ui) {
    j.main = './dist/index.html'
    j.exports = { '.': './dist/' }
  } else if (job.keepDeps) {
    // core 包：publishConfig 已有，只转 workspace 版本
    for (const k of ['dependencies', 'peerDependencies']) {
      if (!j[k]) continue
      for (const d of Object.keys(j[k])) {
        if (String(j[k][d]).startsWith('workspace:')) j[k][d] = '0.1.0'
      }
    }
  } else {
    j.main = './dist/web.js'
    j.exports = { '.': './dist/web.js' }
    if (j.plume) j.plume.web = { ...(j.plume.web || {}), entry: 'dist/web.js' }
    for (const k of ['dependencies', 'peerDependencies']) {
      if (!j[k]) continue
      for (const d of Object.keys(j[k])) {
        if (d.startsWith('@plume-canvas/')) delete j[k][d]
        else if (String(j[k][d]).startsWith('workspace:')) j[k][d] = '*'
      }
      if (Object.keys(j[k]).length === 0) delete j[k]
    }
  }
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n')
  try {
    execFileSync('npm', ['publish', '--access', 'public'], { cwd: pkgDir, stdio: 'pipe', env: { ...process.env }, shell: true })
    results.push('OK   ' + name + '@' + nv)
  } catch (e) {
    const err = String(e.stderr || e.message)
    if (err.includes('cannot publish over') || err.includes('previously staged')) results.push('SKIP ' + name + '@' + nv)
    else results.push('FAIL ' + name + '@' + nv + ' :: ' + err.slice(err.length - 160).replace(/\n/g, ' '))
  } finally {
    fs.writeFileSync(pkgPath, backup)
  }
}
console.log(results.join('\n'))
