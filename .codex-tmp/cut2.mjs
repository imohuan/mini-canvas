import fs from 'node:fs'
const F = 'packages/plugins/plugin-group/src/__tests__/groupTopToolbarRender.test.ts'
const lines = fs.readFileSync(F, 'utf8').split('\n')
// 保留到第 141 行（外层 describe 收尾），删掉后面的 DOM 版 describe
const keepEnd = lines.findIndex((l, i) => i > 130 && l === '})')
console.log('keepEnd', keepEnd, JSON.stringify(lines[keepEnd]))
const kept = lines.slice(0, keepEnd + 1)
fs.writeFileSync(F, kept.join('\n') + '\n', 'utf8')
console.log('written', kept.length)
