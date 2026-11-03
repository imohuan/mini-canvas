import fs from 'node:fs';
const L=fs.readFileSync('D:/Code/Git/mini-canvas/docs/research/txt-evolink.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean);
for(let i=0;i<L.length;i++){
  if(/Image generation|图像|text-to-image|\/image|\/ 张|per image/i.test(L[i])){
    console.log(i+' :: '+L.slice(Math.max(0,i-4),i+5).join(' « '));
  }
}

