import fs from 'node:fs'
const F = 'packages/plugins/plugin-group/src/__tests__/groupTopToolbarRender.test.ts'
const lines = fs.readFileSync(F, 'utf8').split('\n')
// 行号 1-based：75 = 外层 describe 开始；91 = 我加的 describe；169 = 它自己的收尾 }）
// 正确结构：外层 describe 里既有原有用例（75..90），也有我加的 describe（91..169），
// 最后补回「色板封闭表」用例（171..179 的内容）与两个收尾 }）
const outerOpen = 75 - 1
const mineStart = 91 - 1
const mineEnd = 169 - 1   // 这一行是 '})' —— 我加的 describe 收尾
console.log('outerOpen', JSON.stringify(lines[outerOpen]))
console.log('mineStart', JSON.stringify(lines[mineStart]))
console.log('mineEnd', JSON.stringify(lines[mineEnd]))
console.log('next', JSON.stringify(lines[mineEnd+1]), JSON.stringify(lines[mineEnd+2]))
// 找出「色板封闭表」用例的范围（171 起到 179）
const closedStart = lines.findIndex(l => l.includes("色板是一张只有预设色的封闭表"))
console.log('closedStart', closedStart)
let closedEnd = closedStart
let depth = 0
for (let i = closedStart - 2; i < lines.length; i++) {
  const t = lines[i]
  if (t.trim().startsWith('it(')) { depth = 1 }
  if (depth > 0) {
    if (t.trim() === '})') { closedEnd = i; break }
  }
}
console.log('closedEnd', closedEnd, JSON.stringify(lines[closedEnd]))
