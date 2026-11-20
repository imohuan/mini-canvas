const fs = require('node:fs')
const path = require('node:path')
const R = 'D:/Code/Git/mini-canvas'
const readmes = JSON.parse(fs.readFileSync(path.join(R, 'scripts/core-readmes.json'), 'utf8'))
for (const [rel, it] of Object.entries(readmes)) {
  const L = []
  L.push('# ' + it.title)
  L.push('')
  L.push('> `' + it.name + '`')
  L.push('')
  L.push(it.desc)
  L.push('')
  L.push('## 特性', '')
  for (const b of it.bullets) L.push("- " + b)
  L.push('')
  L.push('## 安装', '', '```bash', 'npm i ' + it.name, '```', '')
  fs.writeFileSync(path.join(R, rel), L.join('\n'), 'utf8')
  console.log('OK', rel)
}
