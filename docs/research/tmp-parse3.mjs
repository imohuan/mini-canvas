import fs from 'node:fs';
const L=fs.readFileSync('D:/Code/Git/mini-canvas/docs/research/tmp-apimart.txt','utf8').split('\n').map(x=>x.trim()).filter(Boolean);
const models=[];
for(let j=1;j<L.length;j++){ if(/^\d+ price tiers$/.test(L[j])){ models.push(L[j-1]); } }
console.log('MODELS('+models.length+'):');
console.log([...new Set(models)].join('\n'));

