import fs from 'node:fs'
const F = 'packages/plugins/plugin-group/src/__tests__/groupTopToolbarRender.test.ts'
const lines = fs.readFileSync(F, 'utf8').split('\n')
// 第一次插入的（内存渲染器版）在 91 行起；第二次插入的（DOM 版）在 182 行起
const first = lines.findIndex(l => l.startsWith("describe('点「解散分组」"))
if (first < 0) { console.error('first not found'); process.exit(1) }
const second = lines.findIndex((l, i) => i > first && l.startsWith("describe('点「解散分组」"))
if (second < 0) { console.error('second not found'); process.exit(1) }
// 第二段到文件末尾（它在文件最后被追加）
const tailEnd = lines.length
console.log('first', first, 'second', second, 'end', tailEnd)
console.log('--- second header ---')
console.log(lines.slice(second - 3, second + 4).join('\n'))
console.log('--- keep? first block end ---')
// 找第一段的结束：第二个 describe 之前最后一个非空行
let i = second - 1
while (i > first && lines[i].trim() === '') i--
console.log('first block last line', i, JSON.stringify(lines[i]))
