const fs=require('fs')
const f='packages/ui/src/__tests__/canvasTree.test.ts'
let s=fs.readFileSync(f,'utf8')
const startMark = "describe('filterTree —— 搜索 + 类型过滤（下拉真正生效）', () => {"
const i = s.indexOf(startMark)
console.log('startAt', i)
// 找 canvasTreeBlocks describe 块（我插错位置的那段）
const bStart = s.indexOf("/**\n * 抽屉「画布」树的行块拍平")
console.log('bStart', bStart)
const bEnd = s.indexOf("/**\n * 抽屉「画布」树的行块拍平")
// 用 describe 边界定位：从 blocks describe 起到下一个 describe 之前
const descStart = s.indexOf("describe('canvasTreeBlocks")
const descEnd = s.indexOf("describe('filterTree", descStart)
console.log('descStart', descStart, 'descEnd', descEnd)
