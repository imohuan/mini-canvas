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
/**
 * 前端产物名**按实际文件**取，不写死 dist/web.js。
 *
 * 用户 2026-11-25 实测：plugin-agent / plugin-bottom-bar 的 vite lib 输出叫
 * dist/<包名>.js，这里却统一改成 dist/web.js —— 发布包里声明指着一个不存在的文件，
 * 安装端只能靠「dist 下唯一候选」兜底；清单里那条 url 一旦不兜底就是 404，
 * 市场卡片也就装不上。声明与文件必须同名。
 */
const distDir = require('node:path').join(require('node:path').dirname(p), 'dist')
const distJs = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => f.endsWith('.js') && !f.endsWith('.map'))
  : []
const serverLike = /^(server|plugin-server|agent-server)\.js$/
const declaredWeb = j.plume?.web?.entry?.replace(/^dist\//, '')
const webFile =
  (declaredWeb && distJs.includes(declaredWeb) ? declaredWeb : undefined) ??
  distJs.find((f) => !serverLike.test(f)) ??
  'web.js'
j.main = './dist/' + webFile
j.exports = { '.': './dist/' + webFile }
if (j.plume) j.plume.web = { ...((j.plume.web) || {}), entry: 'dist/' + webFile }
// dist/server.js 在而声明不在 → 回填 server.entry（2026-11-23 用户实测：
// plugin-node-ui 0.1.4 发布包里 server.js 在、声明缺失，装出来的副本没有后台半，
// canvas_ui_* 等 MCP 工具全部消失）。有后台半的插件发布形态必须带 server 声明。
if (j.plume && !j.plume.server && fs.existsSync(require('node:path').join(require('node:path').dirname(p), 'dist', 'server.js'))) {
  j.plume.server = { entry: 'dist/server.js' }
}
// 后端入口指向前端产物 → 视为「没有后台半」删掉（用户 2026-11-25 实测：
// 底部状态栏 / 快捷键把前端 UMD 写进了 server.entry，启动时被当 Node 脚本加载，
// 报 Cannot read properties of undefined (reading 'defineComponent')）。
if (j.plume && j.plume.server && j.plume.web && j.plume.server.entry === j.plume.web.entry) {
  delete j.plume.server
}
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
