import fs from 'node:fs';
const files=['evolink','together','replicate','siliconflow'];
for(const f of files){
  let s='';
  try{ s=fs.readFileSync(`D:/Code/Git/mini-canvas/docs/research/tmp-${f}.html`,'utf8'); }catch(e){ console.log(f,'NOFILE'); continue; }
  s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
  const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
  fs.writeFileSync(`D:/Code/Git/mini-canvas/docs/research/txt-${f}.txt`, L.join('\n'));
  console.log('=====',f,'lines',L.length);
  const hits=L.filter(x=>/\$ ?[0-9]/.test(x)&&x.length<160);
  console.log(hits.slice(0,120).join(' | '));
}

