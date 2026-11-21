const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas/packages/plugins'
let n = 0
for (const d of fs.readdirSync(R)) {
  if (!d.startsWith('plugin-')) continue
  const p = path.join(R, d, 'package.json')
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  const desc = j.plume && j.plume.description
  if (desc && j.description !== desc) {
    j.description = desc
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n', 'utf8')
    n++
  }
}
console.log('description filled for', n, 'plugins')
