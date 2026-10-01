import fs from 'node:fs';
let s=fs.readFileSync('D:/Code/Git/mini-canvas/docs/research/tmp-tokenplus.html','utf8');
s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
console.log('LINES',L.length);
const rows=L.filter(x=>/\$[0-9]/.test(x)&&x.length<200);
console.log([...new Set(rows)].slice(0,110).join('\n'));

