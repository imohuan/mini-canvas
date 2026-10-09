import fs from 'node:fs'
const src = fs.readFileSync('D:/Code/Git/mini-canvas/packages/ui/src/components/areas/LeftDrawer.vue', 'utf8')
const lines = src.split('\n')
const hit = lines.map((l,i)=>({i, t: l.trim()})).filter(x => x.t.includes('AxScrollArea'))
for (const h of hit) console.log(h.i, JSON.stringify(h.t))
const s = lines.findIndex((l) => l.trim().startsWith('<template v-for="node in visibleTree"'))
console.log('start', s)
