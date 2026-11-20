// swap-dev-to-pub <pkgPath> [--restore]  发布形态切换
// 发布形态：main/exports 指 dist、plume.web/server.entry 回填、
// 删除所有 @plume-canvas/* 内部依赖（运行时由宿主全局提供，UMD 产物不 import 它们）、
// workspace:* 转 *（第三方依赖兜底）。
const fs = require('node:fs')
const p = process.argv[2]
if (!p) { console.error('usage: node swap-dev-to-pub.cjs <pkgPath> [--restore]'); process.exit(1) }
if (process.argv.includes('--restore')) {
  fs.writeFileSync(p, fs.readFileSync(p + '.pubbak'))
  fs.rmSync(p + '.pubbak', { force: true })
  console.log('restored ' + p)
  process.exit(0)
}
const b = fs.readFileSync(p, 'utf8')
fs.writeFileSync(p + '.pubbak', b)
const j = JSON.parse(b)
j.main = './dist/web.js'
j.exports = { '.': './dist/web.js' }
if (j.plume) j.plume.web = { ...((j.plume.web) || {}), entry: 'dist/web.js' }
for (const k of ['dependencies', 'peerDependencies']) {
  if (!j[k]) continue
  for (const d of Object.keys(j[k])) {
    if (d.startsWith('@plume-canvas/')) delete j[k][d]
    else if (String(j[k][d]).startsWith('workspace:')) j[k][d] = '*'
  }
  if (Object.keys(j[k]).length === 0) delete j[k]
}
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')
console.log('swapped ' + p)
