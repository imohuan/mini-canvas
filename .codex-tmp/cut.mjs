import fs from 'node:fs'
const F = 'packages/plugins/plugin-group/src/__tests__/groupTopToolbarRender.test.ts'
const lines = fs.readFileSync(F, 'utf8').split('\n')
// 删掉第二段（DOM 版）：从它的注释块开头（describe 前的 '/**'）到文件末尾
const second = lines.findIndex((l, i) => i > 100 && l.startsWith("describe('点「解散分组」"))
let start = second - 1
while (start > 0 && lines[start].trim() !== '') start--
// 往上找到注释块开头
while (start > 0 && lines[start - 1].trim().startsWith('*')) start--
console.log('cut from', start, JSON.stringify(lines.slice(start, start + 3)))
const kept = lines.slice(0, start)
// 收口：去掉尾部多余空行，留一个换行结尾
while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop()
fs.writeFileSync(F, kept.join('\n') + '\n', 'utf8')
console.log('written lines', kept.length)
