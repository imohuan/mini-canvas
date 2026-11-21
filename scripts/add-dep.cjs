const fs = require('node:fs')
const pkgPath = process.argv[2]
const dep = process.argv[3]
const j = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
j.dependencies = j.dependencies || {}
if (!j.dependencies[dep]) {
  j.dependencies[dep] = 'workspace:*'
  fs.writeFileSync(pkgPath, JSON.stringify(j, null, 2) + '\n', 'utf8')
  console.log('added', dep, 'to', pkgPath)
} else console.log('already has', dep)
