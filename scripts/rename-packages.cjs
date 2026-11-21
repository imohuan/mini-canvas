const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
const SKIP = ['node_modules', 'dist', '.git', 'backup', '.plume', '.plume-realtest', '.plume-selftest', 'assets', 'docs-2026-11-03']
let files = 0, refs = 0
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.includes(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { walk(p); continue }
    if (!/\.(ts|vue|json|mjs|css|mts|cts|html|md)$/.test(name)) continue
    let s = fs.readFileSync(p, 'utf8')
    const before = s
    s = s.split('@plume-canvas/cloud-server').join('@plume-canvas/server')
    s = s.split('@plume-canvas/ui').join('@plume-canvas/web')
    if (s !== before) {
      refs += (before.split('@plume-canvas/cloud-server').length - 1) + (before.split('@plume-canvas/ui').length - 1)
      fs.writeFileSync(p, s, 'utf8')
      files++
    }
  }
}
walk(R)
console.log('files changed:', files, 'refs replaced:', refs)
