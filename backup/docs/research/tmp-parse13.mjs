import fs from 'node:fs';
// extract all prices from apimart_sd25 page (seedance-2.5 model)
const f='apimart_sd';
let s=fs.readFileSync(`D:/Code/Git/mini-canvas/docs/research/tmp-${f}.html`,'utf8');
s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
const i=L.indexOf('定价详情');
console.log('PRICING IDX',i);
if(i>0) console.log(L.slice(i,i+40).join(' | '));
// also 480p/720p/1080p mentions
const rr=L.filter(x=>/480p|720p|1080p/.test(x));
console.log('RES', JSON.stringify([...new Set(rr)].slice(0,20)));

