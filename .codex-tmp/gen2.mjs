import fs from 'node:fs'
const FILE = 'D:/Code/Git/mini-canvas/packages/ui/src/components/areas/LeftDrawer.vue'
const src = fs.readFileSync(FILE, 'utf8')
const nl = src.includes('\r\n') ? '\r\n' : '\n'
const lines = src.split(nl)
const NEW = fs.readFileSync('D:/Code/Git/mini-canvas/.codex-tmp/tree-region.txt', 'utf8').split(/\r?\n/)
if (NEW[NEW.length - 1] === '') NEW.pop()
const startLine = lines.findIndex((l) => l.trim().startsWith('<template v-for="node in visibleTree"'))
if (startLine < 0) { console.error('START NOT FOUND'); process.exit(1) }
const scrollStart = lines.findIndex((l) => l.trim().startsWith('<AxScrollArea v-if="isCanvasTab"'))
if (scrollStart < 0) { console.error('SCROLL NOT FOUND'); process.exit(1) }
let endLine = -1
for (let i = scrollStart; i < lines.length; i++) { if (lines[i].trim() === '</AxScrollArea>') { endLine = i; break } }
if (endLine < 0) { console.error('END NOT FOUND'); process.exit(1) }
if (endLine <= startLine) { console.error('ORDER BAD'); process.exit(1) }
const ctxBefore = lines[startLine - 1]
const ctxAfter = lines[endLine]
const oldRegion = lines.slice(startLine, endLine)
const payload = ['*** Begin Patch', '*** Update File: D:/Code/Git/mini-canvas/packages/ui/src/components/areas/LeftDrawer.vue', '@@', ' ' + ctxBefore, ...oldRegion.map((l) => '-' + l), ...NEW.map((l) => '+' + l), ' ' + ctxAfter, '*** End Patch', ''].join(nl)
fs.writeFileSync('D:/Code/Git/mini-canvas/.codex-tmp/tree-patch.txt', payload, 'utf8')
console.log('OK old=' + oldRegion.length + ' new=' + NEW.length)
