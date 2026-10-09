import fs from 'node:fs'
const F = 'packages/plugins/plugin-group/src/__tests__/groupTopToolbarRender.test.ts'
const lines = fs.readFileSync(F, 'utf8').split('\n')
// 目标结构：
//   75: describe('分组节点上控制栏', () => {
//   ... 原有用例 ...
//   91: describe('点「解散分组」...')   ← 嵌套在我的用例里
//   169: })                            ← 我的 describe 收尾
//   171..179: 色板封闭表用例（原本就在外层 describe 里，缩进两格）
//   181: })                            ← 外层 describe 收尾
// 问题：169 之后缺了「外层 describe 收尾」，而 179/181 现在重复。
// 做法：把 169 行的 '})' 保留（我的 describe 收尾），
//      然后把 179 行 '  })' 换成 '})'（外层收尾），删掉 181 行那个多余的 '})'。
const mineEnd = lines.findIndex((l, i) => i > 90 && l === '})')
console.log('mineEnd', mineEnd)
const closedEndIt = lines.findIndex((l, i) => i > 170 && l === '  })')
console.log('closedEndIt', closedEndIt)
const strayClose = lines.findIndex((l, i) => i > closedEndIt && l === '})')
console.log('strayClose', strayClose)
const out = lines.slice(0, strayClose).map((l, i) => (i === closedEndIt ? '})' : l))
while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
fs.writeFileSync(F, out.join('\n') + '\n', 'utf8')
console.log('written', out.length)
