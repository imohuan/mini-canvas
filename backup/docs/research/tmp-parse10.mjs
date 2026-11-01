import fs from 'node:fs';
let s=fs.readFileSync('D:/Code/Git/mini-canvas/docs/research/tmp-apimart_v.html','utf8');
s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
console.log('LINES',L.length);
// find model name lines followed by price
const out=[];
for(let i=0;i<L.length;i++){
  const c=L[i];
  if(/^[A-Za-z0-9][A-Za-z0-9 \-\.\/\(\)]{2,45}$/.test(c) && /seedance|kling|wan|hailuo|grok|vidu|veo|sora|minimax|pixverse|skyreels|seedream|flux|gpt-image|nano|imagen|midjourney|qwen/i.test(c)){
    const near=L.slice(i+1,i+14).filter(x=>/^\$?[0-9]/.test(x)||/\/s$|\/张|\/sec|Credits/.test(x));
    if(near.length) out.push(c+' => '+near.slice(0,3).join(' , '));
  }
}
console.log([...new Set(out)].join('\n'));

