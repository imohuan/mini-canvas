import fs from 'node:fs';
const L=fs.readFileSync('D:/Code/Git/mini-canvas/docs/research/txt-evolink.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
// model id lines look like xxx-text-to-video or similar; find them and pair with nearest 低至$ or $ price
const ids=[],prices=[];
for(let i=0;i<L.length;i++){
  if(/^[a-z0-9][a-z0-9\-\.\/]{4,60}$/.test(L[i]) && /(-to-video|-to-image|video|image)/.test(L[i])) ids.push([i,L[i]]);
  if(/^\$?[0-9]+\.[0-9]+$/.test(L[i])) prices.push([i,L[i]]);
}
console.log('IDS',ids.length,'PRICES',prices.length);
for(const [i,id] of ids){
  const near=prices.filter(([j])=>j>i&&j<i+25).slice(0,3).map(([,p])=>p);
  const ctx=L.slice(Math.max(0,i-6),i+2).filter(x=>/低至|Video gen|text to/i.test(x)).slice(-2);
  if(near.length) console.log(id+' => '+near.join(' , ')+'  ['+ctx.join('/')+']');
}

