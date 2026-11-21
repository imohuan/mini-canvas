const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
const SKIP = ['node_modules', 'dist', '.git', 'backup', '.plume', '.plume-realtest', '.plume-selftest', 'assets', 'docs-2026-11-03']
let files = 0
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.includes(name)) continue
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) { walk(p); continue }
    if (!/\.(ts|vue|json|mjs|css|mts|cts|html|md)$/.test(name)) continue
    let s = fs.readFileSync(p, 'utf8')
    const before = s
    s = s.split('@plume-canvas/web-kit').join('@plume-canvas/ui-kit')
    if (s !== before) { fs.writeFileSync(p, s, 'utf8'); files++ }
  }
}
walk(R)
console.log('fixed files:', files)
